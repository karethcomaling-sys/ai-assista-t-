const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;
let minimizeToTray = true;

const SERVER_PORT = Number(process.env.PORT || 3000);
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

function readStoredSettings() {
  try {
    const settingsFile = path.join(process.cwd(), '.hey-assistant-data', 'settings.json');
    if (fs.existsSync(settingsFile)) {
      return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    }
  } catch {
    // Ignore read errors
  }
  return {};
}

function waitForServer(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(`${url}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', retry);
      req.setTimeout(1200, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Local Hey Assistant AI server did not respond in time.'));
        return;
      }
      setTimeout(ping, 300);
    };

    ping();
  });
}

function startLocalServer() {
  const isPackaged = app.isPackaged;
  const appRoot = isPackaged ? process.resourcesPath : process.cwd();
  const compiledServer = path.join(appRoot, 'dist-server', 'server.mjs');
  const sourceServer = path.join(appRoot, 'server.ts');
  const serverEntry = fs.existsSync(compiledServer) ? compiledServer : sourceServer;

  const env = {
    ...process.env,
    PORT: String(SERVER_PORT),
    NODE_ENV: 'production',
    ELECTRON_HOST: '1',
  };

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: appRoot,
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: 'inherit',
    shell: false,
  });
}

function createTrayIcon() {
  // 16x16 solid cobalt circle SVG encoded cleanly as a nativeImage data URL
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">' +
    '<rect width="16" height="16" rx="4" fill="#2563EB"/>' +
    '<path d="M8 3.5a1.5 1.5 0 0 0-1.5 1.5v3a1.5 1.5 0 0 0 3 0V5A1.5 1.5 0 0 0 8 3.5Z" fill="#FFFFFF"/>' +
    '<path d="M5 8a3 3 0 0 0 6 0" stroke="#FFFFFF" stroke-width="1.3" fill="none" stroke-linecap="round"/>' +
    '</svg>';
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const icon = nativeImage.createFromDataURL(dataUrl);

  tray = new Tray(icon);
  tray.setToolTip('Hey Assistant AI');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Hey Assistant AI',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#0B0F17',
    title: 'Hey Assistant AI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

const singleLock = app.requestSingleInstanceLock();
if (!singleLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const stored = readStoredSettings();
    if (typeof stored.minimizeToTray === 'boolean') {
      minimizeToTray = stored.minimizeToTray;
    }
    if (process.platform === 'win32' && typeof stored.startWithWindows === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: stored.startWithWindows });
    }

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      if (permission === 'media' || permission === 'audioCapture') {
        callback(true);
      } else {
        callback(false);
      }
    });

    ipcMain.on('set-start-with-windows', (_event, enabled) => {
      if (process.platform === 'win32') {
        app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
      }
    });

    ipcMain.on('set-minimize-to-tray', (_event, enabled) => {
      minimizeToTray = Boolean(enabled);
    });

    ipcMain.on('show-window', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    ipcMain.on('quit-app', () => {
      isQuitting = true;
      app.quit();
    });

    if (!process.env.SKIP_INTERNAL_SERVER) {
      startLocalServer();
    }
    await waitForServer(SERVER_URL);
    createTrayIcon();
    createWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
  });
}
