import {
  Calculator,
  Camera,
  Clock,
  ExternalLink,
  FileText,
  Flashlight,
  Globe,
  Keyboard,
  Layers,
  MousePointer,
  Search,
  ShieldAlert,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useState } from 'react';
import type {
  CommandResult,
  SystemCapabilities,
  WindowsCommandName,
} from '../types/assistant';

interface CommandConsoleViewProps {
  systemInfo: SystemCapabilities | null;
  auditLog: CommandResult[];
  directManipulationEnabled: boolean;
  onToggleDirectManipulation: (enabled: boolean) => Promise<void>;
  onExecuteCommand: (command: WindowsCommandName, args?: Record<string, unknown>) => Promise<CommandResult | undefined>;
}

export function CommandConsoleView({
  systemInfo,
  auditLog,
  directManipulationEnabled,
  onToggleDirectManipulation,
  onExecuteCommand,
}: CommandConsoleViewProps) {
  const [websiteInput, setWebsiteInput] = useState('https://learn.microsoft.com');
  const [searchInput, setSearchInput] = useState('Windows 11 voice shortcuts');
  const [mouseX, setMouseX] = useState(500);
  const [mouseY, setMouseY] = useState(500);
  const [coordSpace, setCoordSpace] = useState<'normalized' | 'pixels'>('normalized');
  const [typeInput, setTypeInput] = useState('Hello from Hey Assistant AI');
  const [windowTitleInput, setWindowTitleInput] = useState('Notepad');
  const [latestScreenshot, setLatestScreenshot] = useState<string | null>(null);
  const [latestWindows, setLatestWindows] = useState<NonNullable<CommandResult['windowsList']>>([]);
  const [runningKey, setRunningKey] = useState<string | null>(null);

  const runAction = async (
    key: string,
    command: WindowsCommandName,
    args?: Record<string, unknown>
  ) => {
    setRunningKey(key);
    try {
      const result = await onExecuteCommand(command, args);
      if (result?.screenshotDataUrl) {
        setLatestScreenshot(result.screenshotDataUrl);
      }
      if (result?.windowsList) {
        setLatestWindows(result.windowsList);
      }
    } finally {
      setRunningKey(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">
            Windows 11 Secure Command Interface
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Allowlisted desktop actions only. Arbitrary shell execution is disabled, and sensitive actions require explicit confirmation.
          </p>
        </div>
        <div className="text-xs text-slate-400 font-mono tabular-nums">
          Host: {systemInfo?.isWindows ? 'Windows 11 Native' : `Preview (${systemInfo?.platform ?? 'web'})`} ·{' '}
          {systemInfo?.isElectron ? 'Electron Desktop' : 'Browser + Node Server'}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <div className="rounded-xl border border-white/10 bg-[#121826] p-5">
            <h3 className="text-sm font-semibold text-slate-200">Desktop Applications</h3>
            <p className="mt-1 text-xs text-slate-400">
              Launch verified Windows 11 system tools via voice or quick trigger.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => runAction('notepad', 'open_application', { app: 'notepad' })}
                disabled={runningKey === 'notepad'}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#0B0F17] px-4 py-3 text-left transition-colors hover:border-blue-500/40 hover:bg-white/[0.03]"
              >
                <FileText className="h-4 w-4 text-blue-400 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-slate-100">Notepad</div>
                  <div className="text-xs text-slate-400">notepad.exe</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => runAction('calculator', 'open_application', { app: 'calculator' })}
                disabled={runningKey === 'calculator'}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#0B0F17] px-4 py-3 text-left transition-colors hover:border-blue-500/40 hover:bg-white/[0.03]"
              >
                <Calculator className="h-4 w-4 text-blue-400 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-slate-100">Calculator</div>
                  <div className="text-xs text-slate-400">calc.exe</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => runAction('chrome', 'open_application', { app: 'chrome' })}
                disabled={runningKey === 'chrome'}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#0B0F17] px-4 py-3 text-left transition-colors hover:border-blue-500/40 hover:bg-white/[0.03]"
              >
                <Globe className="h-4 w-4 text-blue-400 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-slate-100">Chrome</div>
                  <div className="text-xs text-slate-400">chrome.exe</div>
                </div>
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#121826] p-5 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-200">Web Navigation & Search</h3>
              <p className="mt-1 text-xs text-slate-400">
                Public http/https URLs only. Private networks and unsafe protocols are blocked.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                runAction('website', 'open_website', { url: websiteInput });
              }}
              className="flex gap-2.5"
            >
              <input
                type="text"
                value={websiteInput}
                onChange={(e) => setWebsiteInput(e.target.value)}
                placeholder="https://example.com"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0B0F17] px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={runningKey === 'website'}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 whitespace-nowrap shrink-0"
              >
                <ExternalLink className="h-4 w-4" />
                Open Website
              </button>
            </form>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                runAction('search', 'search_google', { query: searchInput });
              }}
              className="flex gap-2.5"
            >
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search Google..."
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0B0F17] px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={runningKey === 'search'}
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#0B0F17] px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-white/5 whitespace-nowrap shrink-0"
              >
                <Search className="h-4 w-4 text-blue-400" />
                Search Google
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#121826] p-5">
            <h3 className="text-sm font-semibold text-slate-200">System Controls & Hardware</h3>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => runAction('time', 'get_current_datetime')}
                className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-200 transition-colors hover:border-blue-500/40"
              >
                <Clock className="h-4 w-4 text-blue-400 shrink-0" />
                <span className="truncate">Time & Date</span>
              </button>

              <button
                type="button"
                onClick={() => runAction('vol-up', 'adjust_volume', { action: 'increase', steps: 5 })}
                className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-200 transition-colors hover:border-blue-500/40"
              >
                <Volume2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <span className="truncate">Volume Up</span>
              </button>

              <button
                type="button"
                onClick={() => runAction('vol-down', 'adjust_volume', { action: 'decrease', steps: 5 })}
                className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-200 transition-colors hover:border-blue-500/40"
              >
                <VolumeX className="h-4 w-4 text-amber-400 shrink-0" />
                <span className="truncate">Volume Down</span>
              </button>

              <button
                type="button"
                onClick={() => runAction('flash-on', 'control_flashlight', { state: 'on' })}
                className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-200 transition-colors hover:border-blue-500/40"
              >
                <Flashlight className="h-4 w-4 text-amber-300 shrink-0" />
                <span className="truncate">Flashlight On</span>
              </button>

              <button
                type="button"
                onClick={() => runAction('flash-off', 'control_flashlight', { state: 'off' })}
                className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-200 transition-colors hover:border-blue-500/40"
              >
                <Flashlight className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="truncate">Flashlight Off</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  runAction('confirm-test', 'request_sensitive_confirmation', {
                    action_type: 'delete_file',
                    summary: 'Example safety gate: Delete temporary report.txt',
                  })
                }
                className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-200 transition-colors hover:border-amber-500/40"
              >
                <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                <span className="truncate">Test Safety Gate</span>
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Flashlight status: {systemInfo?.flashlightReason ?? 'Checking compatible Windows Lamp hardware...'}
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#121826] p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">
                  Direct Computer Manipulation
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Screen capture, cursor movement/clicks, keyboard typing, safe shortcuts, and Windows 11 window focus.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={directManipulationEnabled}
                onClick={() => onToggleDirectManipulation(!directManipulationEnabled)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  directManipulationEnabled
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : 'border-white/15 bg-[#0B0F17] text-slate-400'
                }`}
              >
                <span>{directManipulationEnabled ? 'Control Enabled' : 'Control Disabled'}</span>
              </button>
            </div>

            <div className="space-y-3 border-t border-white/10 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-300">
                  <Camera className="h-3.5 w-3.5 text-blue-400" />
                  Screen Vision & Capture
                </span>
                <button
                  type="button"
                  onClick={() => runAction('capture', 'capture_screen')}
                  disabled={!directManipulationEnabled || runningKey === 'capture'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Camera className="h-3.5 w-3.5" />
                  Capture Screen
                </button>
              </div>
              {latestScreenshot && (
                <div className="overflow-hidden rounded-lg border border-white/10 bg-[#0B0F17]">
                  <img
                    src={latestScreenshot}
                    alt="Captured Windows 11 primary screen"
                    className="max-h-56 w-full object-contain"
                  />
                </div>
              )}
            </div>

            <div className="space-y-3 border-t border-white/10 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-300">
                  <MousePointer className="h-3.5 w-3.5 text-blue-400" />
                  Mouse Pointer & Scroll
                </span>
                <select
                  value={coordSpace}
                  onChange={(e) => setCoordSpace(e.target.value as 'normalized' | 'pixels')}
                  className="rounded-lg border border-white/10 bg-[#0B0F17] px-2.5 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                >
                  <option value="normalized">Normalized (0–1000)</option>
                  <option value="pixels">Screen Pixels</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <label className="block text-[11px] text-slate-400">
                  X
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={mouseX}
                    onChange={(e) => setMouseX(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs tabular-nums text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="block text-[11px] text-slate-400">
                  Y
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={mouseY}
                    onChange={(e) => setMouseY(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs tabular-nums text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  disabled={!directManipulationEnabled}
                  onClick={() =>
                    runAction('mouse-move', 'mouse_action', {
                      action: 'move',
                      x: mouseX,
                      y: mouseY,
                      coordinate_space: coordSpace,
                    })
                  }
                  className="self-end rounded-lg border border-white/15 bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  Move
                </button>
                <button
                  type="button"
                  disabled={!directManipulationEnabled}
                  onClick={() =>
                    runAction('mouse-click', 'mouse_action', {
                      action: 'left_click',
                      x: mouseX,
                      y: mouseY,
                      coordinate_space: coordSpace,
                    })
                  }
                  className="self-end rounded-lg border border-white/15 bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  Left Click
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!directManipulationEnabled}
                  onClick={() =>
                    runAction('mouse-dbl', 'mouse_action', {
                      action: 'double_click',
                      x: mouseX,
                      y: mouseY,
                      coordinate_space: coordSpace,
                    })
                  }
                  className="rounded-lg border border-white/10 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
                >
                  Double Click
                </button>
                <button
                  type="button"
                  disabled={!directManipulationEnabled}
                  onClick={() =>
                    runAction('mouse-rclick', 'mouse_action', {
                      action: 'right_click',
                      x: mouseX,
                      y: mouseY,
                      coordinate_space: coordSpace,
                    })
                  }
                  className="rounded-lg border border-white/10 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
                >
                  Right Click
                </button>
                <button
                  type="button"
                  disabled={!directManipulationEnabled}
                  onClick={() =>
                    runAction('scroll-up', 'mouse_action', { action: 'scroll_up', scroll_amount: 4 })
                  }
                  className="rounded-lg border border-white/10 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
                >
                  Scroll Up
                </button>
                <button
                  type="button"
                  disabled={!directManipulationEnabled}
                  onClick={() =>
                    runAction('scroll-down', 'mouse_action', { action: 'scroll_down', scroll_amount: 4 })
                  }
                  className="rounded-lg border border-white/10 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
                >
                  Scroll Down
                </button>
              </div>
            </div>

            <div className="space-y-3 border-t border-white/10 pt-4">
              <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-300">
                <Keyboard className="h-3.5 w-3.5 text-blue-400" />
                Keyboard Input & Safe Shortcuts
              </span>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  runAction('kb-type', 'keyboard_type', { text: typeInput, press_enter: false });
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={typeInput}
                  onChange={(e) => setTypeInput(e.target.value)}
                  placeholder="Text to type into active window..."
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!directManipulationEnabled || !typeInput.trim()}
                  className="rounded-lg border border-white/15 bg-[#0B0F17] px-3.5 py-1.5 text-xs font-medium text-slate-100 hover:bg-white/5 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  Type Text
                </button>
              </form>

              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['copy', 'Copy (Ctrl+C)'],
                    ['paste', 'Paste (Ctrl+V)'],
                    ['undo', 'Undo (Ctrl+Z)'],
                    ['select_all', 'Select All'],
                    ['switch_window', 'Alt+Tab'],
                    ['show_desktop', 'Show Desktop'],
                  ] as const
                ).map(([shortcut, label]) => (
                  <button
                    key={shortcut}
                    type="button"
                    disabled={!directManipulationEnabled}
                    onClick={() => runAction(`sc-${shortcut}`, 'keyboard_shortcut', { shortcut })}
                    className="rounded-lg border border-white/10 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3 border-t border-white/10 pt-4">
              <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-300">
                <Layers className="h-3.5 w-3.5 text-blue-400" />
                Window Management
              </span>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={windowTitleInput}
                  onChange={(e) => setWindowTitleInput(e.target.value)}
                  placeholder="Window title (e.g., Notepad)"
                  className="min-w-[160px] flex-1 rounded-lg border border-white/10 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!directManipulationEnabled}
                  onClick={() => runAction('win-list', 'window_control', { action: 'list' })}
                  className="rounded-lg border border-white/15 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  List Windows
                </button>
                <button
                  type="button"
                  disabled={!directManipulationEnabled || !windowTitleInput.trim()}
                  onClick={() =>
                    runAction('win-focus', 'window_control', {
                      action: 'focus',
                      title: windowTitleInput,
                    })
                  }
                  className="rounded-lg border border-white/15 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  Focus
                </button>
                <button
                  type="button"
                  disabled={!directManipulationEnabled || !windowTitleInput.trim()}
                  onClick={() =>
                    runAction('win-min', 'window_control', {
                      action: 'minimize',
                      title: windowTitleInput,
                    })
                  }
                  className="rounded-lg border border-white/15 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  Minimize
                </button>
                <button
                  type="button"
                  disabled={!directManipulationEnabled || !windowTitleInput.trim()}
                  onClick={() =>
                    runAction('win-max', 'window_control', {
                      action: 'maximize',
                      title: windowTitleInput,
                    })
                  }
                  className="rounded-lg border border-white/15 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  Maximize
                </button>
              </div>
              {latestWindows.length > 0 && (
                <div className="divide-y divide-white/10 rounded-lg border border-white/10 bg-[#0B0F17] text-xs">
                  {latestWindows.map((win) => (
                    <div
                      key={`${win.pid}-${win.title}`}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                    >
                      <span className="truncate text-slate-200">
                        {win.title}{' '}
                        <span className="font-mono text-slate-400">({win.processName})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setWindowTitleInput(win.title);
                          runAction(`focus-${win.pid}`, 'window_control', {
                            action: 'focus',
                            title: win.title,
                          });
                        }}
                        className="text-blue-400 hover:underline whitespace-nowrap shrink-0"
                      >
                        Focus
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#121826] p-5 lg:col-span-5 flex flex-col">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h3 className="text-sm font-semibold text-slate-200">Command Execution Log</h3>
            <span className="font-mono text-xs tabular-nums text-slate-400">
              {auditLog.length} entries
            </span>
          </div>

          {auditLog.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
              <p className="text-sm font-medium text-slate-300">No commands executed yet</p>
              <p className="mt-1 max-w-xs text-xs text-slate-400">
                Ask the assistant by voice (e.g., "Open Notepad", "Buksan ang Calculator", "Ablihi ang Chrome") or trigger a control on the left.
              </p>
            </div>
          ) : (
            <div className="mt-3 flex-1 space-y-2.5 overflow-y-auto max-h-[540px] pr-1">
              {auditLog.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-white/8 bg-[#0B0F17] p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-medium text-slate-200">
                      {entry.command}
                    </span>
                    <span className="font-mono tabular-nums text-slate-400">
                      {new Date(entry.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-300">{entry.summary}</p>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      Status: <strong className="font-medium text-slate-200">{entry.status}</strong> ·{' '}
                      {entry.platform}
                    </span>
                    {entry.launchUrl && (
                      <a
                        href={entry.launchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-400 hover:underline"
                      >
                        Open link <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
