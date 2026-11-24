const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  setStartWithWindows: (enabled) => ipcRenderer.send('set-start-with-windows', Boolean(enabled)),
  setMinimizeToTray: (enabled) => ipcRenderer.send('set-minimize-to-tray', Boolean(enabled)),
  showWindow: () => ipcRenderer.send('show-window'),
  quitApp: () => ipcRenderer.send('quit-app'),
});
