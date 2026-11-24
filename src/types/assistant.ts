export type LanguagePreference = 'auto' | 'en' | 'tl' | 'ceb';

export type VoiceName = 'Zephyr' | 'Puck' | 'Kore' | 'Fenrir' | 'Charon';

export type AssistantStatus =
  | 'idle'
  | 'connecting'
  | 'wake_armed'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export type WindowsCommandName =
  | 'open_application'
  | 'open_website'
  | 'search_google'
  | 'get_current_datetime'
  | 'adjust_volume'
  | 'control_flashlight'
  | 'capture_screen'
  | 'mouse_action'
  | 'keyboard_type'
  | 'keyboard_shortcut'
  | 'window_control'
  | 'open_map_location'
  | 'request_sensitive_confirmation';

export type SensitiveActionType =
  | 'send_message'
  | 'make_call'
  | 'delete_file'
  | 'purchase'
  | 'other';

export interface WindowSummary {
  processName: string;
  title: string;
  pid: number;
}

export interface MapLocationRequest {
  query: string;
  origin?: string;
  destination?: string;
  travelMode?: 'DRIVING' | 'WALKING' | 'BICYCLING' | 'TRANSIT';
}

export interface CommandResult {
  id: string;
  command: WindowsCommandName;
  status: 'executed' | 'preview_only' | 'unsupported' | 'blocked' | 'pending_confirmation' | 'cancelled';
  summary: string;
  details?: string;
  launchUrl?: string;
  screenshotDataUrl?: string;
  windowsList?: WindowSummary[];
  mapRequest?: MapLocationRequest;
  timestamp: string;
  platform: string;
  confirmationId?: string;
  sensitiveActionType?: SensitiveActionType;
}

export interface PendingConfirmation {
  id: string;
  actionType: SensitiveActionType;
  summary: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  detectedLanguage?: string;
  timestamp: string;
  isInterim?: boolean;
  commandResult?: CommandResult;
}

export interface ConversationSession {
  id: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  language: LanguagePreference;
  messages: TranscriptMessage[];
}

export interface AssistantSettings {
  language: LanguagePreference;
  voiceName: VoiceName;
  wakeWordEnabled: boolean;
  wakePhrase: string;
  pushToTalkKey: string;
  systemPrompt: string;
  startWithWindows: boolean;
  minimizeToTray: boolean;
  autoReconnect: boolean;
  directManipulationEnabled: boolean;
  selectedMicId: string;
}

export interface SystemCapabilities {
  platform: string;
  isWindows: boolean;
  isElectron: boolean;
  nodeVersion: string;
  flashlightSupported: boolean;
  flashlightReason: string;
  currentTime: string;
  currentDate: string;
  timezone: string;
  apiConfigured: boolean;
  mapsConfigured?: boolean;
}

export const LANGUAGE_OPTIONS: ReadonlyArray<{
  value: LanguagePreference;
  label: string;
  nativeLabel: string;
  hint: string;
}> = [
  {
    value: 'auto',
    label: 'Auto-Detect',
    nativeLabel: 'EN / TL / CEB',
    hint: 'Automatically detects English, Filipino/Tagalog, or Cebuano/Bisaya.',
  },
  {
    value: 'en',
    label: 'English',
    nativeLabel: 'English',
    hint: 'Responds in clear, natural English.',
  },
  {
    value: 'tl',
    label: 'Filipino / Tagalog',
    nativeLabel: 'Filipino',
    hint: 'Responds naturally in Filipino / Tagalog.',
  },
  {
    value: 'ceb',
    label: 'Cebuano / Bisaya',
    nativeLabel: 'Bisaya',
    hint: 'Responds naturally in Cebuano / Bisaya.',
  },
];

export const VOICE_OPTIONS: ReadonlyArray<{
  value: VoiceName;
  label: string;
  tone: string;
}> = [
  { value: 'Zephyr', label: 'Zephyr', tone: 'Balanced, clear neutral' },
  { value: 'Puck', label: 'Puck', tone: 'Energetic, conversational' },
  { value: 'Kore', label: 'Kore', tone: 'Warm, articulate' },
  { value: 'Fenrir', label: 'Fenrir', tone: 'Deep, grounded' },
  { value: 'Charon', label: 'Charon', tone: 'Calm, analytical' },
];

export const DEFAULT_SYSTEM_PROMPT = `You are Hey Assistant AI, a helpful, concise, and professional voice-controlled personal assistant for Windows 11.

Language rules:
- You are fluent in English, Filipino/Tagalog, and Cebuano/Bisaya.
- Automatically detect the language the user is speaking and reply in the exact same language naturally. If they speak Taglish or Bislish, match their natural phrasing respectfully.

Behavior & safety rules:
- Keep spoken replies concise, direct, and easy to listen to.
- Use the provided Windows command tools when the user asks to open Notepad, Calculator, Chrome, a website, search Google, check the current time/date, adjust volume, or check/control the flashlight.
- NEVER claim to have executed a sensitive action (sending messages, making calls, deleting files, or making purchases) on your own. Always call request_sensitive_confirmation first and wait for explicit user confirmation.`;
