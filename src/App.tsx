import {
  AlertCircle,
  Check,
  ExternalLink,
  Hand,
  History,
  Loader2,
  MapPin,
  Menu,
  Mic,
  MicOff,
  Radio,
  Send,
  Settings,
  ShieldAlert,
  Square,
  Terminal,
  Volume2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CommandConsoleView } from './components/CommandConsoleView';
import { HistoryView } from './components/HistoryView';
import { MapsView } from './components/MapsView';
import { MicTestModal } from './components/MicTestModal';
import { SettingsView } from './components/SettingsView';
import { useVoiceAssistant } from './hooks/useVoiceAssistant';
import {
  type AssistantSettings,
  type AssistantStatus,
  type CommandResult,
  type ConversationSession,
  DEFAULT_SYSTEM_PROMPT,
  LANGUAGE_OPTIONS,
  type MapLocationRequest,
  type SystemCapabilities,
  type TranscriptMessage,
  VOICE_OPTIONS,
  type WindowsCommandName,
} from './types/assistant';

type NavTab = 'console' | 'maps' | 'history' | 'commands' | 'settings';

const DEFAULT_CLIENT_SETTINGS: AssistantSettings = {
  language: 'auto',
  voiceName: 'Zephyr',
  wakeWordEnabled: false,
  wakePhrase: 'hey assistant',
  pushToTalkKey: 'Space',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  startWithWindows: false,
  minimizeToTray: true,
  autoReconnect: true,
  directManipulationEnabled: true,
  selectedMicId: 'default',
};

function getStatusMeta(status: AssistantStatus) {
  switch (status) {
    case 'listening':
      return {
        label: 'Listening',
        sublabel: 'Streaming 16kHz voice to Gemini Live',
        colorClass: 'text-emerald-400',
        borderClass: 'border-emerald-500/40',
        bgClass: 'bg-emerald-500/15',
      };
    case 'processing':
      return {
        label: 'Processing',
        sublabel: 'Understanding intent and preparing response',
        colorClass: 'text-amber-400',
        borderClass: 'border-amber-500/40',
        bgClass: 'bg-amber-500/15',
      };
    case 'speaking':
      return {
        label: 'Speaking',
        sublabel: 'Playing Gemini Live voice response',
        colorClass: 'text-sky-400',
        borderClass: 'border-sky-500/40',
        bgClass: 'bg-sky-500/15',
      };
    case 'connecting':
      return {
        label: 'Connecting',
        sublabel: 'Establishing real-time voice session',
        colorClass: 'text-blue-400',
        borderClass: 'border-blue-500/40',
        bgClass: 'bg-blue-500/15',
      };
    case 'wake_armed':
      return {
        label: 'Wake Word Armed',
        sublabel: 'Say "Hey Assistant" or press the microphone',
        colorClass: 'text-blue-400',
        borderClass: 'border-blue-500/30',
        bgClass: 'bg-blue-500/10',
      };
    case 'error':
      return {
        label: 'Attention Needed',
        sublabel: 'Check the notice below to resume',
        colorClass: 'text-red-400',
        borderClass: 'border-red-500/40',
        bgClass: 'bg-red-500/15',
      };
    default:
      return {
        label: 'Ready',
        sublabel: 'Press the microphone, hold Space, or type below',
        colorClass: 'text-slate-300',
        borderClass: 'border-white/15',
        bgClass: 'bg-white/5',
      };
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('console');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [micTestOpen, setMicTestOpen] = useState(false);
  const [settings, setSettings] = useState<AssistantSettings>(DEFAULT_CLIENT_SETTINGS);
  const [systemInfo, setSystemInfo] = useState<SystemCapabilities | null>(null);
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [auditLog, setAuditLog] = useState<CommandResult[]>([]);
  const [textDraft, setTextDraft] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => `session-${Date.now()}`);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);
  const [pendingMapRequest, setPendingMapRequest] = useState<MapLocationRequest | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  const handleCommandResult = useCallback((result: CommandResult) => {
    setAuditLog((prev) => [result, ...prev].slice(0, 100));
    if (result.command === 'open_map_location' && result.mapRequest) {
      setPendingMapRequest(result.mapRequest);
      setActiveTab('maps');
    }
  }, []);

  const persistSessionMessages = useCallback(
    async (msgs: TranscriptMessage[]) => {
      if (msgs.length === 0) return;
      const firstUser = msgs.find((m) => m.role === 'user');
      const title = firstUser
        ? firstUser.text.slice(0, 64) + (firstUser.text.length > 64 ? '…' : '')
        : 'Voice Assistant Session';

      const payload: ConversationSession = {
        id: currentSessionId,
        title,
        startedAt: msgs[0].timestamp,
        updatedAt: msgs[msgs.length - 1].timestamp,
        language: settings.language,
        messages: msgs,
      };

      try {
        const res = await fetch('/api/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = (await res.json()) as { sessions?: ConversationSession[] };
          if (data.sessions) setSessions(data.sessions);
        }
      } catch {
        // Ignore transient history save failures
      }
    },
    [currentSessionId, settings.language]
  );

  const {
    status,
    connectionState,
    errorMessage,
    setErrorMessage,
    inputLevel,
    messages,
    interimUserText,
    interimAssistantText,
    pushToTalkActive,
    wakeListenerSupported,
    wakeDetectedFlash,
    toggleListening,
    interruptAssistant,
    startPushToTalk,
    stopPushToTalk,
    sendTextMessage,
    confirmSensitiveAction,
    clearMessages,
    loadSessionMessages,
  } = useVoiceAssistant({
    settings,
    onCommandResult: handleCommandResult,
    onSessionUpdate: persistSessionMessages,
  });

  // Load initial settings, system info, and history
  useEffect(() => {
    const loadInitial = async () => {
      try {
        const [settingsRes, sysRes, historyRes] = await Promise.all([
          fetch('/api/settings'),
          fetch('/api/system-info'),
          fetch('/api/history'),
        ]);
        if (settingsRes.ok) {
          const s = (await settingsRes.json()) as AssistantSettings;
          setSettings(s);
        }
        if (sysRes.ok) {
          const info = (await sysRes.json()) as SystemCapabilities;
          setSystemInfo(info);
        }
        if (historyRes.ok) {
          const h = (await historyRes.json()) as {
            sessions?: ConversationSession[];
            auditLog?: CommandResult[];
          };
          if (h.sessions) setSessions(h.sessions);
          if (h.auditLog) setAuditLog(h.auditLog);
        }
      } catch {
        // Initial load handled gracefully
      }
    };
    loadInitial();
  }, []);

  // Scroll transcript to bottom on new messages
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, interimUserText, interimAssistantText]);

  // Spacebar Push-to-Talk fallback when focused outside text inputs
  useEffect(() => {
    let spaceHeld = false;
    const isEditable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (activeTab !== 'console' || micTestOpen) return;
      if (e.code === 'Space' && !e.repeat && !isEditable(e.target)) {
        e.preventDefault();
        spaceHeld = true;
        startPushToTalk();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && spaceHeld) {
        e.preventDefault();
        spaceHeld = false;
        stopPushToTalk();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [activeTab, micTestOpen, startPushToTalk, stopPushToTalk]);

  const updateSettings = useCallback(async (partial: Partial<AssistantSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      if (res.ok) {
        const saved = (await res.json()) as AssistantSettings;
        setSettings(saved);
      }
    } catch {
      // Optimistic local state remains
    }
  }, []);

  const executeQuickCommand = useCallback(
    async (
      command: WindowsCommandName,
      args?: Record<string, unknown>
    ): Promise<CommandResult | undefined> => {
      const res = await fetch('/api/commands/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, args }),
      });
      if (res.ok) {
        const data = (await res.json()) as { result?: CommandResult };
        if (data.result) {
          handleCommandResult(data.result);
          return data.result;
        }
      }
      return undefined;
    },
    [handleCommandResult]
  );

  const handleClearHistory = useCallback(async () => {
    await fetch('/api/history', { method: 'DELETE' });
    setSessions([]);
  }, []);

  const handleLoadSession = useCallback(
    (session: ConversationSession) => {
      setCurrentSessionId(session.id);
      loadSessionMessages(session.messages);
      setActiveTab('console');
    },
    [loadSessionMessages]
  );

  const handleNewSession = useCallback(() => {
    setCurrentSessionId(`session-${Date.now()}`);
    clearMessages();
  }, [clearMessages]);

  const statusMeta = getStatusMeta(status);
  const isLiveActive =
    status === 'listening' ||
    status === 'processing' ||
    status === 'speaking' ||
    status === 'connecting';

  const navItems: ReadonlyArray<{ id: NavTab; label: string; icon: typeof Mic }> = [
    { id: 'console', label: 'Voice Console', icon: Mic },
    { id: 'maps', label: 'Map & Places', icon: MapPin },
    { id: 'history', label: 'History', icon: History },
    { id: 'commands', label: 'Commands', icon: Terminal },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const pageTitle =
    activeTab === 'console'
      ? 'Voice Console'
      : activeTab === 'maps'
        ? 'Map & Places'
        : activeTab === 'history'
          ? 'History'
          : activeTab === 'commands'
            ? 'Commands'
            : 'Settings';

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0B0F17] text-slate-100">
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Mobile Sidebar Backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Left Sidebar (260px) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] shrink-0 flex-col border-r border-white/10 bg-[#0E131F] transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
          <span className="font-display text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
            Hey Assistant AI
          </span>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileNavOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-blue-600/15 text-blue-400'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4 space-y-2.5 text-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span>Wake Phrase</span>
            <button
              type="button"
              onClick={() => updateSettings({ wakeWordEnabled: !settings.wakeWordEnabled })}
              className={`font-medium transition-colors ${
                settings.wakeWordEnabled ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {settings.wakeWordEnabled ? 'On' : 'Off'}
            </button>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>Start with Windows</span>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="text-slate-300 hover:text-white"
            >
              {settings.startWithWindows ? 'Enabled' : 'Disabled'}
            </button>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>Direct Control</span>
            <button
              type="button"
              onClick={() =>
                updateSettings({
                  directManipulationEnabled: !settings.directManipulationEnabled,
                })
              }
              className={`font-medium transition-colors ${
                settings.directManipulationEnabled
                  ? 'text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {settings.directManipulationEnabled ? 'On' : 'Off'}
            </button>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>Minimize to Tray</span>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="text-slate-300 hover:text-white"
            >
              {settings.minimizeToTray ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar (3-zone contract) */}
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-[#0B0F17] px-4 lg:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="rounded-lg p-2 text-slate-400 hover:bg-white/5 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="truncate text-base font-semibold text-slate-100 whitespace-nowrap shrink-0">
              {pageTitle}
            </h1>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <label htmlFor="topbar-language" className="sr-only">
              Language
            </label>
            <select
              id="topbar-language"
              value={settings.language}
              onChange={(e) =>
                updateSettings({ language: e.target.value as AssistantSettings['language'] })
              }
              className="rounded-lg border border-white/10 bg-[#121826] px-3 py-1.5 text-xs font-medium text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <label htmlFor="topbar-voice" className="sr-only">
              Voice
            </label>
            <select
              id="topbar-voice"
              value={settings.voiceName}
              onChange={(e) =>
                updateSettings({ voiceName: e.target.value as AssistantSettings['voiceName'] })
              }
              className="rounded-lg border border-white/10 bg-[#121826] px-3 py-1.5 text-xs font-medium text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.value} value={v.value}>
                  Voice: {v.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setMicTestOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#121826] px-3.5 py-2 text-xs font-medium text-slate-100 transition-colors hover:border-blue-500/50 hover:bg-white/5 whitespace-nowrap shrink-0"
            >
              <Mic className="h-3.5 w-3.5 text-blue-400" />
              <span>Test Microphone</span>
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 overflow-y-auto">
          {activeTab === 'console' && (
            <div className="mx-auto flex h-full max-w-5xl flex-col px-4 py-5 lg:px-8">
              {/* Error Banner if API Key / Mic Permission / Connection fails */}
              {errorMessage && (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
                  <div className="flex items-center gap-2.5">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                    <span>{errorMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setErrorMessage(null)}
                    className="rounded p-1 text-red-300 hover:bg-red-500/20"
                    aria-label="Dismiss error"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Focal Anchor: Voice Control Stage */}
              <section className="rounded-xl border border-white/10 bg-[#121826] px-6 py-7">
                <div className="flex flex-col items-center text-center">
                  {/* Explicit Status Indicator (Icon + Text, never color alone) */}
                  <div
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${statusMeta.borderClass} ${statusMeta.bgClass} ${statusMeta.colorClass}`}
                  >
                    {status === 'listening' && <Radio className="h-3.5 w-3.5" />}
                    {status === 'processing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {status === 'speaking' && <Volume2 className="h-3.5 w-3.5" />}
                    {status === 'connecting' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {status === 'wake_armed' && <Mic className="h-3.5 w-3.5" />}
                    {status === 'error' && <AlertCircle className="h-3.5 w-3.5" />}
                    {status === 'idle' && <MicOff className="h-3.5 w-3.5" />}
                    <span>{statusMeta.label}</span>
                  </div>

                  {/* Large Microphone Button */}
                  <div className="relative mt-6 flex items-center justify-center">
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute rounded-full border border-blue-500/30 transition-transform duration-100"
                      style={{
                        width: '132px',
                        height: '132px',
                        transform: `scale(${isLiveActive ? 1 + inputLevel * 0.24 : 1})`,
                        opacity: isLiveActive ? 0.35 + inputLevel * 0.6 : 0,
                      }}
                    />

                    <button
                      type="button"
                      onClick={toggleListening}
                      aria-label={isLiveActive ? 'Stop listening' : 'Start listening'}
                      className={`relative flex h-28 w-28 items-center justify-center rounded-full border transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500 ${
                        status === 'listening'
                          ? 'border-emerald-400/60 bg-emerald-600 text-white shadow-lg shadow-emerald-950/50 hover:bg-emerald-500'
                          : status === 'speaking'
                            ? 'border-sky-400/60 bg-sky-600 text-white shadow-lg shadow-sky-950/50 hover:bg-sky-500'
                            : status === 'processing' || status === 'connecting'
                              ? 'border-amber-400/60 bg-amber-600 text-white shadow-lg shadow-amber-950/50'
                              : 'border-blue-400/40 bg-blue-600 text-white shadow-lg shadow-blue-950/60 hover:bg-blue-500'
                      }`}
                    >
                      {isLiveActive ? (
                        <Square className="h-9 w-9 fill-current" />
                      ) : (
                        <Mic className="h-10 w-10" />
                      )}
                    </button>
                  </div>

                  <p className="mt-4 text-sm font-medium text-slate-200">
                    {wakeDetectedFlash
                      ? 'Wake phrase "Hey Assistant" detected — listening now'
                      : statusMeta.sublabel}
                  </p>
                  <p className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
                    {connectionState === 'reconnecting'
                      ? 'Reconnecting WebSocket...'
                      : `Language: ${LANGUAGE_OPTIONS.find((l) => l.value === settings.language)?.label} · Voice: ${settings.voiceName}`}
                  </p>

                  {/* Action Controls Row */}
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                    {status === 'speaking' && (
                      <button
                        type="button"
                        onClick={interruptAssistant}
                        className="inline-flex items-center gap-2 rounded-lg border border-sky-400/40 bg-sky-500/15 px-4 py-2 text-xs font-medium text-sky-200 transition-colors hover:bg-sky-500/25 whitespace-nowrap shrink-0"
                      >
                        <Hand className="h-3.5 w-3.5" />
                        Interrupt Assistant
                      </button>
                    )}

                    <button
                      type="button"
                      onMouseDown={startPushToTalk}
                      onMouseUp={stopPushToTalk}
                      onMouseLeave={() => {
                        if (pushToTalkActive) stopPushToTalk();
                      }}
                      onTouchStart={(e) => {
                        e.preventDefault();
                        startPushToTalk();
                      }}
                      onTouchEnd={(e) => {
                        e.preventDefault();
                        stopPushToTalk();
                      }}
                      className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        pushToTalkActive
                          ? 'border-blue-400 bg-blue-600 text-white'
                          : 'border-white/15 bg-[#0B0F17] text-slate-200 hover:bg-white/5'
                      }`}
                    >
                      <Mic className="h-3.5 w-3.5" />
                      {pushToTalkActive ? 'Release to Send' : 'Hold to Talk (Space)'}
                    </button>

                    <button
                      type="button"
                      onClick={() => updateSettings({ wakeWordEnabled: !settings.wakeWordEnabled })}
                      disabled={!wakeListenerSupported}
                      title={
                        wakeListenerSupported
                          ? 'Toggle continuous "Hey Assistant" wake phrase listener'
                          : 'Browser SpeechRecognition unavailable in this host'
                      }
                      className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-medium transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 ${
                        settings.wakeWordEnabled
                          ? 'border-blue-500/50 bg-blue-600/15 text-blue-300'
                          : 'border-white/15 bg-[#0B0F17] text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      <Radio className="h-3.5 w-3.5" />
                      {settings.wakeWordEnabled
                        ? 'Wake "Hey Assistant": On'
                        : 'Wake "Hey Assistant": Off'}
                    </button>

                    {messages.length > 0 && (
                      <button
                        type="button"
                        onClick={handleNewSession}
                        className="rounded-lg border border-white/10 px-3.5 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200 whitespace-nowrap shrink-0"
                      >
                        New Session
                      </button>
                    )}
                  </div>
                </div>
              </section>

              {/* Live Conversation Transcript */}
              <section className="mt-5 flex min-h-[280px] flex-1 flex-col rounded-xl border border-white/10 bg-[#121826]">
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                  <h2 className="text-xs font-semibold text-slate-300">
                    Live Conversation Transcript
                  </h2>
                  <span className="text-xs text-slate-400 font-mono tabular-nums">
                    {messages.length} items
                  </span>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto p-5">
                  {messages.length === 0 && !interimUserText && !interimAssistantText ? (
                    <div className="flex h-full min-h-[180px] flex-col items-center justify-center text-center">
                      <p className="text-sm font-medium text-slate-200">
                        Start a voice or text conversation
                      </p>
                      <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-400">
                        Speak naturally in English, Filipino, or Cebuano. Try saying{' '}
                        <span className="text-slate-200">"Open Notepad"</span>,{' '}
                        <span className="text-slate-200">"Anong oras na ngayon?"</span>, or{' '}
                        <span className="text-slate-200">"Palihug pangitaa sa Google ang weather sa Cebu"</span>.
                      </p>
                    </div>
                  ) : (
                    <>
                      {messages.map((msg) => (
                        <div key={msg.id} className="space-y-1.5">
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <span
                              className={`font-semibold ${
                                msg.role === 'user'
                                  ? 'text-blue-400'
                                  : msg.role === 'assistant'
                                    ? 'text-slate-100'
                                    : 'text-amber-300'
                              }`}
                            >
                              {msg.role === 'user'
                                ? 'You'
                                : msg.role === 'assistant'
                                  ? 'Hey Assistant AI'
                                  : 'Windows Control'}
                            </span>
                            {msg.detectedLanguage && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{msg.detectedLanguage}</span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {new Date(msg.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </span>
                          </div>

                          {msg.commandResult ? (
                            <div className="rounded-lg border border-white/10 bg-[#0B0F17] p-3.5 text-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-slate-200">{msg.commandResult.summary}</span>
                                <span className="font-mono text-xs text-slate-400">
                                  {msg.commandResult.status}
                                </span>
                              </div>
                              {msg.commandResult.details && (
                                <p className="mt-1 text-xs text-slate-400">
                                  {msg.commandResult.details}
                                </p>
                              )}
                              {msg.commandResult.launchUrl && (
                                <a
                                  href={msg.commandResult.launchUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:underline"
                                >
                                  <span>Open verified link</span>
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                              {msg.commandResult.mapRequest && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPendingMapRequest(msg.commandResult!.mapRequest!);
                                    setActiveTab('maps');
                                  }}
                                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:underline"
                                >
                                  <MapPin className="h-3.5 w-3.5" />
                                  <span>Open in Map &amp; Places</span>
                                </button>
                              )}
                              {msg.commandResult.screenshotDataUrl && (
                                <div className="mt-2.5 overflow-hidden rounded-lg border border-white/10">
                                  <img
                                    src={msg.commandResult.screenshotDataUrl}
                                    alt="Captured Windows 11 screen"
                                    className="max-h-56 w-full object-contain bg-black"
                                  />
                                </div>
                              )}
                              {msg.commandResult.windowsList &&
                                msg.commandResult.windowsList.length > 0 && (
                                  <ul className="mt-2 space-y-1 border-t border-white/10 pt-2 text-xs text-slate-300">
                                    {msg.commandResult.windowsList.map((w) => (
                                      <li key={`${w.pid}-${w.title}`} className="truncate">
                                        {w.title}{' '}
                                        <span className="font-mono text-slate-400">
                                          ({w.processName})
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              {msg.commandResult.status === 'pending_confirmation' &&
                                msg.commandResult.confirmationId && (
                                  <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-white/10 pt-3">
                                    <div className="flex items-center gap-1.5 text-xs text-amber-300 mr-auto">
                                      <ShieldAlert className="h-4 w-4 shrink-0" />
                                      <span>Confirmation required before proceeding</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        confirmSensitiveAction(
                                          msg.commandResult!.confirmationId!,
                                          'approved'
                                        )
                                      }
                                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 whitespace-nowrap shrink-0"
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                      Confirm Action
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        confirmSensitiveAction(
                                          msg.commandResult!.confirmationId!,
                                          'rejected'
                                        )
                                      }
                                      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5 whitespace-nowrap shrink-0"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                )}
                            </div>
                          ) : (
                            <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">
                              {msg.text}
                            </p>
                          )}
                        </div>
                      ))}

                      {interimUserText && (
                        <div className="space-y-1 opacity-80">
                          <div className="text-xs font-semibold text-blue-400">
                            You · speaking...
                          </div>
                          <p className="text-sm text-slate-300">{interimUserText}</p>
                        </div>
                      )}

                      {interimAssistantText && (
                        <div className="space-y-1 opacity-90">
                          <div className="text-xs font-semibold text-sky-400">
                            Hey Assistant AI · speaking...
                          </div>
                          <p className="text-sm text-slate-200">{interimAssistantText}</p>
                        </div>
                      )}
                      <div ref={transcriptEndRef} />
                    </>
                  )}
                </div>

                {/* Text Fallback & Direct Input */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!textDraft.trim()) return;
                    const value = textDraft;
                    setTextDraft('');
                    sendTextMessage(value);
                  }}
                  className="flex items-center gap-2.5 border-t border-white/10 p-3"
                >
                  <input
                    type="text"
                    value={textDraft}
                    onChange={(e) => setTextDraft(e.target.value)}
                    placeholder="Type a message or command in English, Filipino, or Cebuano..."
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!textDraft.trim() || status === 'processing'}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Send className="h-4 w-4" />
                    <span className="hidden sm:inline">Send</span>
                  </button>
                </form>
              </section>
            </div>
          )}

          {activeTab === 'maps' && (
            <MapsView
              language={settings.language}
              pendingRequest={pendingMapRequest}
              onConsumePendingRequest={() => setPendingMapRequest(null)}
            />
          )}

          {activeTab === 'history' && (
            <HistoryView
              sessions={sessions}
              onLoadSession={handleLoadSession}
              onClearHistory={handleClearHistory}
            />
          )}

          {activeTab === 'commands' && (
            <CommandConsoleView
              systemInfo={systemInfo}
              auditLog={auditLog}
              directManipulationEnabled={settings.directManipulationEnabled}
              onToggleDirectManipulation={(enabled) =>
                updateSettings({ directManipulationEnabled: enabled })
              }
              onExecuteCommand={executeQuickCommand}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              settings={settings}
              systemInfo={systemInfo}
              onUpdateSettings={updateSettings}
              onOpenMicTest={() => setMicTestOpen(true)}
            />
          )}
        </main>
      </div>
      </div>

      <MicTestModal
        isOpen={micTestOpen}
        selectedMicId={settings.selectedMicId}
        onSelectMic={(deviceId) => updateSettings({ selectedMicId: deviceId })}
        onClose={() => setMicTestOpen(false)}
      />
    </div>
  );
}
