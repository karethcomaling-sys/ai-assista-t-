import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { CommandResult, WindowSummary } from '../src/types/assistant.ts';
import { loadSettings } from './storage.ts';
import { createSensitiveConfirmation } from './windowsCommands.ts';

const execFileAsync = promisify(execFile);

export interface DirectCaptureResult {
  commandResult: CommandResult;
  screenshotBase64?: string;
}

function checkDirectManipulationAllowed(command: CommandResult['command']): CommandResult | null {
  const settings = loadSettings();
  if (!settings.directManipulationEnabled) {
    return {
      id: crypto.randomUUID(),
      command,
      status: 'blocked',
      summary: 'Direct computer manipulation is currently disabled in Settings.',
      details: 'Enable "Direct Computer Manipulation" in Settings or the sidebar to allow mouse, keyboard, window, and screen controls.',
      timestamp: new Date().toISOString(),
      platform: process.platform,
    };
  }
  return null;
}

export async function captureDesktopScreen(): Promise<DirectCaptureResult> {
  const blocked = checkDirectManipulationAllowed('capture_screen');
  if (blocked) return { commandResult: blocked };

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  if (process.platform !== 'win32') {
    return {
      commandResult: {
        id,
        command: 'capture_screen',
        status: 'preview_only',
        summary: 'Desktop screen capture prepared for Windows 11.',
        details: 'Screen capture uses Windows .NET Graphics.CopyFromScreen when running locally on Windows 11.',
        timestamp,
        platform: process.platform,
      },
    };
  }

  try {
    const psScript =
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      'Add-Type -AssemblyName System.Drawing; ' +
      '$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ' +
      '$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height); ' +
      '$g = [System.Drawing.Graphics]::FromImage($bmp); ' +
      '$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); ' +
      '$maxW = 1280; ' +
      'if ($bounds.Width -gt $maxW) { ' +
      '  $newH = [int]($bounds.Height * ($maxW / $bounds.Width)); ' +
      '  $scaled = New-Object System.Drawing.Bitmap($bmp, $maxW, $newH); ' +
      '  $bmp.Dispose(); $bmp = $scaled; ' +
      '} ' +
      '$ms = New-Object System.IO.MemoryStream; ' +
      '$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg); ' +
      '$b64 = [Convert]::ToBase64String($ms.ToArray()); ' +
      '$ms.Dispose(); $g.Dispose(); $bmp.Dispose(); ' +
      'Write-Output "$($bounds.Width)x$($bounds.Height)|$b64"';

    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 6000, maxBuffer: 8 * 1024 * 1024 }
    );

    const [dims, b64] = stdout.trim().split('|');
    if (!b64) {
      throw new Error('Screen bitmap buffer was empty.');
    }

    return {
      screenshotBase64: b64,
      commandResult: {
        id,
        command: 'capture_screen',
        status: 'executed',
        summary: `Captured Windows 11 primary screen (${dims}).`,
        screenshotDataUrl: `data:image/jpeg;base64,${b64}`,
        timestamp,
        platform: process.platform,
      },
    };
  } catch (err) {
    return {
      commandResult: {
        id,
        command: 'capture_screen',
        status: 'unsupported',
        summary: 'Unable to capture Windows 11 screen.',
        details: err instanceof Error ? err.message : 'Screen capture failed.',
        timestamp,
        platform: process.platform,
      },
    };
  }
}

export async function performMouseAction(args: Record<string, unknown>): Promise<CommandResult> {
  const blocked = checkDirectManipulationAllowed('mouse_action');
  if (blocked) return blocked;

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const validActions = [
    'move',
    'left_click',
    'double_click',
    'right_click',
    'scroll_up',
    'scroll_down',
  ] as const;

  const action = typeof args.action === 'string' ? args.action.trim().toLowerCase() : '';
  if (!validActions.includes(action as (typeof validActions)[number])) {
    return {
      id,
      command: 'mouse_action',
      status: 'blocked',
      summary: `Blocked invalid mouse action "${String(args.action)}".`,
      timestamp,
      platform: process.platform,
    };
  }

  const coordinateSpace = args.coordinate_space === 'normalized' ? 'normalized' : 'pixels';
  const hasCoords = typeof args.x === 'number' && typeof args.y === 'number' && Number.isFinite(args.x) && Number.isFinite(args.y);
  const xVal = hasCoords ? Math.max(0, Math.min(10000, Math.round(args.x as number))) : null;
  const yVal = hasCoords ? Math.max(0, Math.min(10000, Math.round(args.y as number))) : null;
  const scrollSteps =
    typeof args.scroll_amount === 'number' && Number.isFinite(args.scroll_amount)
      ? Math.max(1, Math.min(10, Math.round(args.scroll_amount)))
      : 3;

  if (
    (action === 'move' || action === 'left_click' || action === 'double_click' || action === 'right_click') &&
    (xVal === null || yVal === null)
  ) {
    return {
      id,
      command: 'mouse_action',
      status: 'blocked',
      summary: `Mouse action "${action}" requires numeric x and y coordinates.`,
      timestamp,
      platform: process.platform,
    };
  }

  if (process.platform !== 'win32') {
    const coordLabel = hasCoords ? ` at (${xVal}, ${yVal} ${coordinateSpace})` : '';
    return {
      id,
      command: 'mouse_action',
      status: 'preview_only',
      summary: `Mouse ${action.replace('_', ' ')}${coordLabel} queued for Windows 11.`,
      details: 'Direct Win32 mouse input executes when running locally on Windows 11.',
      timestamp,
      platform: process.platform,
    };
  }

  try {
    const moveSnippet = hasCoords
      ? coordinateSpace === 'normalized'
        ? `$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $px = [int]($b.Width * ${xVal} / 1000); $py = [int]($b.Height * ${yVal} / 1000); [WinInput]::SetCursorPos($px, $py) | Out-Null; `
        : `[WinInput]::SetCursorPos(${xVal}, ${yVal}) | Out-Null; `
      : '';

    let eventSnippet = '';
    if (action === 'left_click') {
      eventSnippet = '[WinInput]::mouse_event(0x02,0,0,0,0); [WinInput]::mouse_event(0x04,0,0,0,0);';
    } else if (action === 'double_click') {
      eventSnippet =
        '[WinInput]::mouse_event(0x02,0,0,0,0); [WinInput]::mouse_event(0x04,0,0,0,0); Start-Sleep -Milliseconds 60; [WinInput]::mouse_event(0x02,0,0,0,0); [WinInput]::mouse_event(0x04,0,0,0,0);';
    } else if (action === 'right_click') {
      eventSnippet = '[WinInput]::mouse_event(0x08,0,0,0,0); [WinInput]::mouse_event(0x10,0,0,0,0);';
    } else if (action === 'scroll_up') {
      eventSnippet = `[WinInput]::mouse_event(0x0800,0,0,${scrollSteps * 120},0);`;
    } else if (action === 'scroll_down') {
      eventSnippet = `[WinInput]::mouse_event(0x0800,0,0,-${scrollSteps * 120},0);`;
    }

    const psScript =
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      'Add-Type -TypeDefinition "using System; using System.Runtime.InteropServices; public class WinInput { [DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int X, int Y); [DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo); }"; ' +
      moveSnippet +
      eventSnippet;

    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 4000 }
    );

    const coordLabel = hasCoords ? ` at (${xVal}, ${yVal} ${coordinateSpace})` : '';
    return {
      id,
      command: 'mouse_action',
      status: 'executed',
      summary: `Executed mouse ${action.replace('_', ' ')}${coordLabel} on Windows 11.`,
      timestamp,
      platform: process.platform,
    };
  } catch (err) {
    return {
      id,
      command: 'mouse_action',
      status: 'unsupported',
      summary: `Failed to execute mouse ${action}.`,
      details: err instanceof Error ? err.message : 'Win32 mouse_event failed.',
      timestamp,
      platform: process.platform,
    };
  }
}

export async function performKeyboardType(args: Record<string, unknown>): Promise<CommandResult> {
  const blocked = checkDirectManipulationAllowed('keyboard_type');
  if (blocked) return blocked;

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const rawText = typeof args.text === 'string' ? args.text : '';
  const pressEnter = Boolean(args.press_enter);

  if (!rawText || rawText.length > 500) {
    return {
      id,
      command: 'keyboard_type',
      status: 'blocked',
      summary: 'Text to type must be between 1 and 500 characters.',
      timestamp,
      platform: process.platform,
    };
  }

  if (process.platform !== 'win32') {
    return {
      id,
      command: 'keyboard_type',
      status: 'preview_only',
      summary: `Prepared keystrokes for "${rawText.slice(0, 60)}${rawText.length > 60 ? '…' : ''}"${pressEnter ? ' + Enter' : ''}.`,
      details: 'Direct keyboard typing executes into the active Windows 11 window when running locally.',
      timestamp,
      platform: process.platform,
    };
  }

  try {
    // Base64 encode so user text is never parsed as PowerShell syntax
    const b64Text = Buffer.from(rawText, 'utf8').toString('base64');
    const enterSuffix = pressEnter ? ' + "{ENTER}"' : '';
    const psScript =
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      `$raw = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64Text}')); ` +
      '$escaped = [System.Text.RegularExpressions.Regex]::Replace($raw, "([+^%~(){}\\[\\]])", "{$1}"); ' +
      `[System.Windows.Forms.SendKeys]::SendWait($escaped${enterSuffix});`;

    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 4000 }
    );

    return {
      id,
      command: 'keyboard_type',
      status: 'executed',
      summary: `Typed text into focused Windows 11 window${pressEnter ? ' and pressed Enter' : ''}.`,
      timestamp,
      platform: process.platform,
    };
  } catch (err) {
    return {
      id,
      command: 'keyboard_type',
      status: 'unsupported',
      summary: 'Failed to dispatch keyboard input.',
      details: err instanceof Error ? err.message : 'SendKeys failed.',
      timestamp,
      platform: process.platform,
    };
  }
}

const SAFE_SHORTCUTS: Record<string, { sendKeys: string; label: string }> = {
  copy: { sendKeys: '^c', label: 'Copy (Ctrl+C)' },
  paste: { sendKeys: '^v', label: 'Paste (Ctrl+V)' },
  cut: { sendKeys: '^x', label: 'Cut (Ctrl+X)' },
  undo: { sendKeys: '^z', label: 'Undo (Ctrl+Z)' },
  redo: { sendKeys: '^y', label: 'Redo (Ctrl+Y)' },
  select_all: { sendKeys: '^a', label: 'Select All (Ctrl+A)' },
  save: { sendKeys: '^s', label: 'Save (Ctrl+S)' },
  find: { sendKeys: '^f', label: 'Find (Ctrl+F)' },
  enter: { sendKeys: '{ENTER}', label: 'Enter' },
  escape: { sendKeys: '{ESC}', label: 'Escape' },
  tab: { sendKeys: '{TAB}', label: 'Tab' },
  backspace: { sendKeys: '{BACKSPACE}', label: 'Backspace' },
  page_up: { sendKeys: '{PGUP}', label: 'Page Up' },
  page_down: { sendKeys: '{PGDN}', label: 'Page Down' },
  switch_window: { sendKeys: '%{TAB}', label: 'Switch Window (Alt+Tab)' },
  show_desktop: { sendKeys: 'WIN_D', label: 'Show Desktop (Win+D)' },
};

export async function performKeyboardShortcut(args: Record<string, unknown>): Promise<CommandResult> {
  const blocked = checkDirectManipulationAllowed('keyboard_shortcut');
  if (blocked) return blocked;

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const shortcut = typeof args.shortcut === 'string' ? args.shortcut.trim().toLowerCase() : '';

  if (shortcut === 'close_window' || shortcut === 'alt_f4' || shortcut === 'delete') {
    const { commandResult } = createSensitiveConfirmation(
      shortcut === 'delete' ? 'delete_file' : 'other',
      `Execute destructive shortcut "${shortcut}" on active Windows 11 window`
    );
    return commandResult;
  }

  const mapped = SAFE_SHORTCUTS[shortcut];
  if (!mapped) {
    return {
      id,
      command: 'keyboard_shortcut',
      status: 'blocked',
      summary: `Blocked unrecognized or unsafe shortcut "${String(args.shortcut)}".`,
      details: `Allowed shortcuts: ${Object.keys(SAFE_SHORTCUTS).join(', ')}.`,
      timestamp,
      platform: process.platform,
    };
  }

  if (process.platform !== 'win32') {
    return {
      id,
      command: 'keyboard_shortcut',
      status: 'preview_only',
      summary: `Shortcut ${mapped.label} ready for Windows 11.`,
      details: 'Executes in the focused Windows 11 window when running locally.',
      timestamp,
      platform: process.platform,
    };
  }

  try {
    const psScript =
      mapped.sendKeys === 'WIN_D'
        ? '(New-Object -ComObject Shell.Application).ToggleDesktop()'
        : `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${mapped.sendKeys}')`;

    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 3500 }
    );

    return {
      id,
      command: 'keyboard_shortcut',
      status: 'executed',
      summary: `Executed ${mapped.label} on Windows 11.`,
      timestamp,
      platform: process.platform,
    };
  } catch (err) {
    return {
      id,
      command: 'keyboard_shortcut',
      status: 'unsupported',
      summary: `Failed to execute shortcut ${mapped.label}.`,
      details: err instanceof Error ? err.message : 'Shortcut dispatch failed.',
      timestamp,
      platform: process.platform,
    };
  }
}

export async function controlWindowsWindow(args: Record<string, unknown>): Promise<CommandResult> {
  const blocked = checkDirectManipulationAllowed('window_control');
  if (blocked) return blocked;

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const validActions = ['list', 'focus', 'minimize', 'maximize', 'restore'] as const;
  const action = typeof args.action === 'string' ? args.action.trim().toLowerCase() : '';

  if (!validActions.includes(action as (typeof validActions)[number])) {
    return {
      id,
      command: 'window_control',
      status: 'blocked',
      summary: `Unsupported window action "${String(args.action)}".`,
      timestamp,
      platform: process.platform,
    };
  }

  const titleQuery = typeof args.title === 'string' ? args.title.trim().slice(0, 120) : '';
  if (action !== 'list' && !titleQuery) {
    return {
      id,
      command: 'window_control',
      status: 'blocked',
      summary: `Window action "${action}" requires a window title filter.`,
      timestamp,
      platform: process.platform,
    };
  }

  if (process.platform !== 'win32') {
    const previewWindows: WindowSummary[] =
      action === 'list'
        ? [
            { processName: 'HeyAssistantAI', title: 'Hey Assistant AI — Windows 11 Voice Assistant', pid: 1001 },
          ]
        : [];
    return {
      id,
      command: 'window_control',
      status: 'preview_only',
      summary:
        action === 'list'
          ? 'Window enumeration ready (preview host shows active workspace only).'
          : `Window ${action} for "${titleQuery}" queued for Windows 11.`,
      windowsList: previewWindows,
      details: 'Native Win32 window listing and focus control runs locally on Windows 11.',
      timestamp,
      platform: process.platform,
    };
  }

  try {
    if (action === 'list') {
      const psScript =
        'Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne "" } | ' +
        'Select-Object @{N="processName";E={$_.ProcessName}}, @{N="title";E={$_.MainWindowTitle}}, @{N="pid";E={$_.Id}} | ' +
        'ConvertTo-Json -Compress';
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { timeout: 4000 }
      );
      const parsed = stdout.trim() ? JSON.parse(stdout.trim()) : [];
      const list: WindowSummary[] = Array.isArray(parsed) ? parsed : [parsed];
      return {
        id,
        command: 'window_control',
        status: 'executed',
        summary: `Found ${list.length} open Windows 11 application window(s).`,
        windowsList: list,
        timestamp,
        platform: process.platform,
      };
    }

    const b64Title = Buffer.from(titleQuery, 'utf8').toString('base64');
    const swCode = action === 'minimize' ? 6 : action === 'maximize' ? 3 : 9;
    const psScript =
      'Add-Type -TypeDefinition "using System; using System.Runtime.InteropServices; public class WinMgr { [DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport(\\"user32.dll\\")] public static extern bool SetForegroundWindow(IntPtr hWnd); }"; ' +
      `$q = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64Title}')); ` +
      '$proc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle.IndexOf($q, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1; ' +
      'if ($null -eq $proc) { "NOT_FOUND" } else { ' +
      `[WinMgr]::ShowWindow($proc.MainWindowHandle, ${swCode}) | Out-Null; ` +
      (action === 'minimize' ? '' : '[WinMgr]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null; ') +
      'Write-Output "OK|$($proc.MainWindowTitle)" }';

    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 4000 }
    );
    const trimmed = stdout.trim();
    if (!trimmed.startsWith('OK|')) {
      return {
        id,
        command: 'window_control',
        status: 'unsupported',
        summary: `No open window matched "${titleQuery}".`,
        timestamp,
        platform: process.platform,
      };
    }

    return {
      id,
      command: 'window_control',
      status: 'executed',
      summary: `${action[0].toUpperCase()}${action.slice(1)}d window "${trimmed.slice(3)}".`,
      timestamp,
      platform: process.platform,
    };
  } catch (err) {
    return {
      id,
      command: 'window_control',
      status: 'unsupported',
      summary: `Failed to ${action} window "${titleQuery}".`,
      details: err instanceof Error ? err.message : 'Win32 window control error.',
      timestamp,
      platform: process.platform,
    };
  }
}
