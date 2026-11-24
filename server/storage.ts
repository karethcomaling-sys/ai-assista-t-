import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SYSTEM_PROMPT,
  type AssistantSettings,
  type ConversationSession,
} from '../src/types/assistant.ts';

const DATA_DIR = path.resolve(process.cwd(), '.hey-assistant-data');
const SETTINGS_PATH = path.resolve(DATA_DIR, 'settings.json');
const HISTORY_PATH = path.resolve(DATA_DIR, 'history.json');

export const DEFAULT_SETTINGS: AssistantSettings = {
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

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadSettings(): AssistantSettings {
  try {
    ensureDataDir();
    if (!fs.existsSync(SETTINGS_PATH)) {
      return { ...DEFAULT_SETTINGS };
    }
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AssistantSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(partial: Partial<AssistantSettings>): AssistantSettings {
  ensureDataDir();
  const current = loadSettings();
  const updated: AssistantSettings = {
    ...current,
    language:
      partial.language && ['auto', 'en', 'tl', 'ceb'].includes(partial.language)
        ? partial.language
        : current.language,
    voiceName:
      partial.voiceName && ['Zephyr', 'Puck', 'Kore', 'Fenrir', 'Charon'].includes(partial.voiceName)
        ? partial.voiceName
        : current.voiceName,
    wakeWordEnabled:
      typeof partial.wakeWordEnabled === 'boolean' ? partial.wakeWordEnabled : current.wakeWordEnabled,
    wakePhrase:
      typeof partial.wakePhrase === 'string' && partial.wakePhrase.trim()
        ? partial.wakePhrase.trim().toLowerCase().slice(0, 60)
        : current.wakePhrase,
    pushToTalkKey:
      typeof partial.pushToTalkKey === 'string' && partial.pushToTalkKey.trim()
        ? partial.pushToTalkKey.trim().slice(0, 20)
        : current.pushToTalkKey,
    systemPrompt:
      typeof partial.systemPrompt === 'string' && partial.systemPrompt.trim()
        ? partial.systemPrompt.slice(0, 4000)
        : current.systemPrompt,
    startWithWindows:
      typeof partial.startWithWindows === 'boolean' ? partial.startWithWindows : current.startWithWindows,
    minimizeToTray:
      typeof partial.minimizeToTray === 'boolean' ? partial.minimizeToTray : current.minimizeToTray,
    autoReconnect:
      typeof partial.autoReconnect === 'boolean' ? partial.autoReconnect : current.autoReconnect,
    directManipulationEnabled:
      typeof partial.directManipulationEnabled === 'boolean'
        ? partial.directManipulationEnabled
        : current.directManipulationEnabled,
    selectedMicId:
      typeof partial.selectedMicId === 'string' ? partial.selectedMicId.slice(0, 160) : current.selectedMicId,
  };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

export function loadHistory(): ConversationSession[] {
  try {
    ensureDataDir();
    if (!fs.existsSync(HISTORY_PATH)) {
      return [];
    }
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ConversationSession[]) : [];
  } catch {
    return [];
  }
}

export function upsertHistorySession(session: ConversationSession): ConversationSession[] {
  ensureDataDir();
  const list = loadHistory();
  const index = list.findIndex((item) => item.id === session.id);
  if (index >= 0) {
    list[index] = session;
  } else {
    list.unshift(session);
  }
  const bounded = list.slice(0, 50);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(bounded, null, 2), 'utf8');
  return bounded;
}

export function clearHistory(): void {
  ensureDataDir();
  fs.writeFileSync(HISTORY_PATH, JSON.stringify([], null, 2), 'utf8');
}
