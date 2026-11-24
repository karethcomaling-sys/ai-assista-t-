import { Check, Mic, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import {
  type AssistantSettings,
  DEFAULT_SYSTEM_PROMPT,
  LANGUAGE_OPTIONS,
  type SystemCapabilities,
  VOICE_OPTIONS,
} from '../types/assistant';

interface SettingsViewProps {
  settings: AssistantSettings;
  systemInfo: SystemCapabilities | null;
  onUpdateSettings: (partial: Partial<AssistantSettings>) => Promise<void>;
  onOpenMicTest: () => void;
}

export function SettingsView({
  settings,
  systemInfo,
  onUpdateSettings,
  onOpenMicTest,
}: SettingsViewProps) {
  const [promptDraft, setPromptDraft] = useState(settings.systemPrompt);
  const [wakeDraft, setWakeDraft] = useState(settings.wakePhrase);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const flashSaved = (label: string) => {
    setSavedNotice(label);
    window.setTimeout(() => setSavedNotice(null), 2200);
  };

  const handleDesktopToggle = async (
    key: 'startWithWindows' | 'minimizeToTray',
    value: boolean
  ) => {
    await onUpdateSettings({ [key]: value });
    const electronBridge = (
      window as unknown as {
        electronAPI?: {
          setStartWithWindows?: (enabled: boolean) => void;
          setMinimizeToTray?: (enabled: boolean) => void;
        };
      }
    ).electronAPI;

    if (key === 'startWithWindows') {
      electronBridge?.setStartWithWindows?.(value);
    } else {
      electronBridge?.setMinimizeToTray?.(value);
    }
    flashSaved('Windows 11 preference updated');
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Assistant Settings</h2>
          <p className="mt-1 text-sm text-slate-400">
            Configure Gemini voice output, multilingual detection, system instructions, and Windows 11 desktop integration.
          </p>
        </div>

        {savedNotice && (
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <Check className="h-4 w-4" />
            <span>{savedNotice}</span>
          </div>
        )}
      </div>

      <section className="rounded-xl border border-white/10 bg-[#121826] p-6 space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Language & Voice</h3>
          <p className="mt-1 text-xs text-slate-400">
            Auto-Detect identifies English, Filipino/Tagalog, or Cebuano/Bisaya automatically and replies in the same language.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <label
              htmlFor="settings-language"
              className="block text-xs font-medium text-slate-300"
            >
              Spoken Language Mode
            </label>
            <select
              id="settings-language"
              value={settings.language}
              onChange={async (e) => {
                await onUpdateSettings({
                  language: e.target.value as AssistantSettings['language'],
                });
                flashSaved('Language updated');
              }}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} ({opt.nativeLabel})
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-400">
              {LANGUAGE_OPTIONS.find((l) => l.value === settings.language)?.hint}
            </p>
          </div>

          <div>
            <label
              htmlFor="settings-voice"
              className="block text-xs font-medium text-slate-300"
            >
              Gemini Live Voice
            </label>
            <select
              id="settings-voice"
              value={settings.voiceName}
              onChange={async (e) => {
                await onUpdateSettings({
                  voiceName: e.target.value as AssistantSettings['voiceName'],
                });
                flashSaved('Voice updated');
              }}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label} — {v.tone}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-400">
              Applies immediately on the next Live voice session.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-[#121826] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Wake Phrase, Microphone & Reconnection
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Hands-free wake listening, push-to-talk fallback (Spacebar), and microphone verification.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenMicTest}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#0B0F17] px-3.5 py-2 text-xs font-medium text-slate-100 transition-colors hover:border-blue-500/50 whitespace-nowrap shrink-0"
          >
            <Mic className="h-3.5 w-3.5 text-blue-400" />
            Test Microphone
          </button>
        </div>

        <div className="divide-y divide-white/10">
          <div className="flex items-center justify-between gap-4 py-3.5">
            <div>
              <div className="text-sm font-medium text-slate-200">
                Enable Wake Phrase ("Hey Assistant")
              </div>
              <div className="text-xs text-slate-400">
                Keeps a lightweight local listener armed to trigger Gemini Live when you say "{settings.wakePhrase}".
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.wakeWordEnabled}
              onClick={async () => {
                await onUpdateSettings({ wakeWordEnabled: !settings.wakeWordEnabled });
                flashSaved('Wake phrase setting updated');
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                settings.wakeWordEnabled ? 'bg-blue-600' : 'bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.wakeWordEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 py-3.5">
            <div>
              <div className="text-sm font-medium text-slate-200">Wake Phrase Text</div>
              <div className="text-xs text-slate-400">Default is "hey assistant".</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={wakeDraft}
                onChange={(e) => setWakeDraft(e.target.value)}
                className="w-48 rounded-lg border border-white/10 bg-[#0B0F17] px-3 py-1.5 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={async () => {
                  await onUpdateSettings({ wakePhrase: wakeDraft });
                  flashSaved('Wake phrase saved');
                }}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-white/15 whitespace-nowrap shrink-0"
              >
                Save
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 py-3.5">
            <div>
              <div className="text-sm font-medium text-slate-200">
                Automatic Session Reconnection
              </div>
              <div className="text-xs text-slate-400">
                Retries WebSocket voice sessions automatically with exponential backoff if the network drops.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoReconnect}
              onClick={async () => {
                await onUpdateSettings({ autoReconnect: !settings.autoReconnect });
                flashSaved('Reconnection setting updated');
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                settings.autoReconnect ? 'bg-blue-600' : 'bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.autoReconnect ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-[#121826] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Configurable System Prompt</h3>
            <p className="mt-1 text-xs text-slate-400">
              Guides tone, persona, and instruction-following across voice and text sessions.
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              setPromptDraft(DEFAULT_SYSTEM_PROMPT);
              await onUpdateSettings({ systemPrompt: DEFAULT_SYSTEM_PROMPT });
              flashSaved('System prompt reset');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Default
          </button>
        </div>

        <textarea
          rows={6}
          value={promptDraft}
          onChange={(e) => setPromptDraft(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-[#0B0F17] p-3.5 text-sm leading-relaxed text-slate-100 focus:border-blue-500 focus:outline-none"
        />

        <div className="flex justify-end">
          <button
            type="button"
            onClick={async () => {
              await onUpdateSettings({ systemPrompt: promptDraft });
              flashSaved('System prompt saved');
            }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 whitespace-nowrap shrink-0"
          >
            Save System Prompt
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-[#121826] p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Windows 11 & Electron Desktop Options
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            {systemInfo?.isElectron
              ? 'Connected to Electron desktop host. Toggles apply directly to Windows 11 startup and tray behavior.'
              : 'Saved locally in your workspace and applied automatically when launched via the included Electron Windows 11 wrapper.'}
          </p>
        </div>

        <div className="divide-y divide-white/10">
          <div className="flex items-center justify-between gap-4 py-3.5">
            <div>
              <div className="text-sm font-medium text-slate-200">Start with Windows</div>
              <div className="text-xs text-slate-400">
                Registers Hey Assistant AI to launch automatically when you sign into Windows 11.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.startWithWindows}
              onClick={() => handleDesktopToggle('startWithWindows', !settings.startWithWindows)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                settings.startWithWindows ? 'bg-blue-600' : 'bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.startWithWindows ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 py-3.5">
            <div>
              <div className="text-sm font-medium text-slate-200">Minimize to System Tray</div>
              <div className="text-xs text-slate-400">
                Keeps the assistant running quietly in the Windows 11 notification tray when closed.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.minimizeToTray}
              onClick={() => handleDesktopToggle('minimizeToTray', !settings.minimizeToTray)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                settings.minimizeToTray ? 'bg-blue-600' : 'bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.minimizeToTray ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 py-3.5">
            <div>
              <div className="text-sm font-medium text-slate-200">
                Direct Computer Manipulation
              </div>
              <div className="text-xs text-slate-400">
                Allows screen capture, mouse cursor movement/clicks, keyboard typing, safe shortcuts, and window focus on Windows 11.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.directManipulationEnabled}
              onClick={async () => {
                await onUpdateSettings({
                  directManipulationEnabled: !settings.directManipulationEnabled,
                });
                flashSaved('Direct manipulation setting updated');
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                settings.directManipulationEnabled ? 'bg-blue-600' : 'bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.directManipulationEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
