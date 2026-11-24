import { type FunctionDeclaration, GoogleGenAI, Type } from '@google/genai';
import {
  DEFAULT_SYSTEM_PROMPT,
  type CommandResult,
  type LanguagePreference,
} from '../src/types/assistant.ts';
import {
  captureDesktopScreen,
  controlWindowsWindow,
  performKeyboardShortcut,
  performKeyboardType,
  performMouseAction,
} from './directManipulation.ts';
import {
  adjustWindowsVolume,
  controlWindowsFlashlight,
  createSensitiveConfirmation,
  getCurrentDateTime,
  openSafeWebsite,
  openWindowsApp,
  recordAudit,
  searchGoogle,
} from './windowsCommands.ts';

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add it to your environment or Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function getGeminiLiveClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add it to your environment or Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function withGeminiRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const msg = formatGeminiError(err).message.toLowerCase();
      const isTransient =
        msg.includes('503') ||
        msg.includes('high demand') ||
        msg.includes('unavailable') ||
        msg.includes('rate limit') ||
        msg.includes('429');
      if (!isTransient || attempt === maxAttempts) {
        throw err;
      }
      const delayMs = 600 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export function buildSystemInstruction(
  customPrompt: string | undefined,
  languagePreference: LanguagePreference
): string {
  const basePrompt = (customPrompt || DEFAULT_SYSTEM_PROMPT).trim();

  const languageDirective =
    languagePreference === 'en'
      ? 'Language directive: The user has selected English. Respond clearly in English unless they explicitly ask you to translate.'
      : languagePreference === 'tl'
        ? 'Language directive: The user has selected Filipino / Tagalog. Respond naturally in Filipino / Tagalog.'
        : languagePreference === 'ceb'
          ? 'Language directive: The user has selected Cebuano / Bisaya. Respond naturally in Cebuano / Bisaya.'
          : 'Language directive: Automatically detect whether the user speaks or writes in English, Filipino/Tagalog, or Cebuano/Bisaya, and reply in the exact same language naturally.';

  return `${basePrompt}

${languageDirective}

Available Windows 11 controls:
- open_application: Open Notepad, Calculator, or Chrome.
- open_website: Open a validated https:// or http:// website URL.
- search_google: Search Google for a query.
- get_current_datetime: Read the current local time and date.
- adjust_volume: Increase, decrease, mute, or unmute system volume.
- control_flashlight: Check or toggle device flashlight only if compatible hardware exists.
- capture_screen: Capture a screenshot of the current Windows 11 desktop to inspect open UI elements.
- mouse_action: Move cursor, click (left/double/right), or scroll on the Windows 11 desktop using pixel or normalized (0-1000) coordinates.
- keyboard_type: Type plain text into the currently focused Windows 11 window.
- keyboard_shortcut: Press an allowlisted safe keyboard shortcut (copy, paste, undo, select_all, save, find, enter, escape, tab, switch_window, show_desktop).
- window_control: List open Windows 11 windows or focus, minimize, maximize, or restore a window by title.
- open_map_location: Search for a place, address, or compute directions inside the built-in Google Maps & Places view.
- request_sensitive_confirmation: Required BEFORE any sensitive action (sending messages, making calls, deleting files, purchases, or closing/deleting via Alt+F4/Delete). Never claim to execute sensitive actions directly without calling this tool and receiving explicit confirmation.`;
}

export const WINDOWS_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'open_application',
    description:
      'Opens an allowlisted Windows 11 application: Notepad, Calculator, or Google Chrome.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        app: {
          type: Type.STRING,
          description: 'Application identifier: "notepad", "calculator", or "chrome".',
        },
      },
      required: ['app'],
    },
  },
  {
    name: 'open_website',
    description: 'Opens a public website URL in the default browser.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: 'The website domain or full https:// URL to open.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'search_google',
    description: 'Opens a Google Search query in the browser.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'The search query text.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_current_datetime',
    description: 'Reads the current local time, date, and timezone.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'adjust_volume',
    description: 'Adjusts Windows 11 system volume.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'One of: "increase", "decrease", "mute", "unmute".',
        },
        steps: {
          type: Type.INTEGER,
          description: 'Number of volume steps between 1 and 20 (optional, defaults to 5).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'control_flashlight',
    description: 'Turns the Windows device flashlight on or off if a compatible hardware torch exists.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        state: {
          type: Type.STRING,
          description: 'Desired state: "on" or "off".',
        },
      },
      required: ['state'],
    },
  },
  {
    name: 'capture_screen',
    description:
      'Captures a screenshot of the primary Windows 11 desktop so you can see open windows and UI coordinates.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'mouse_action',
    description:
      'Performs direct mouse manipulation on Windows 11 (move, left_click, double_click, right_click, scroll_up, scroll_down).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            'One of: "move", "left_click", "double_click", "right_click", "scroll_up", "scroll_down".',
        },
        x: {
          type: Type.INTEGER,
          description: 'Horizontal coordinate (required for move/click).',
        },
        y: {
          type: Type.INTEGER,
          description: 'Vertical coordinate (required for move/click).',
        },
        coordinate_space: {
          type: Type.STRING,
          description: '"normalized" (0-1000 relative to screen) or "pixels" (default "pixels").',
        },
        scroll_amount: {
          type: Type.INTEGER,
          description: 'Scroll wheel steps between 1 and 10 (optional, defaults to 3).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'keyboard_type',
    description: 'Types plain text into the currently focused Windows 11 application window.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: {
          type: Type.STRING,
          description: 'Plain text to type (max 500 characters).',
        },
        press_enter: {
          type: Type.BOOLEAN,
          description: 'Whether to press Enter after typing (optional).',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'keyboard_shortcut',
    description:
      'Presses an allowlisted safe Windows 11 shortcut (copy, paste, cut, undo, redo, select_all, save, find, enter, escape, tab, backspace, page_up, page_down, switch_window, show_desktop).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        shortcut: {
          type: Type.STRING,
          description: 'Allowlisted shortcut name.',
        },
      },
      required: ['shortcut'],
    },
  },
  {
    name: 'window_control',
    description: 'Lists open Windows 11 windows or focuses, minimizes, maximizes, or restores a window.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'One of: "list", "focus", "minimize", "maximize", "restore".',
        },
        title: {
          type: Type.STRING,
          description: 'Partial window title to match (required for focus/minimize/maximize/restore).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'open_map_location',
    description:
      'Opens the built-in interactive Google Maps view to search for a place, landmark, nearby businesses, or plan directions between an origin and destination.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Place name, address, or search query (e.g., "Coffee shops in Makati", "Cebu IT Park").',
        },
        origin: {
          type: Type.STRING,
          description: 'Optional route starting point address or place name when planning directions.',
        },
        destination: {
          type: Type.STRING,
          description: 'Optional route destination address or place name when planning directions.',
        },
        travel_mode: {
          type: Type.STRING,
          description: 'Optional travel mode: "DRIVING", "WALKING", "BICYCLING", or "TRANSIT".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'request_sensitive_confirmation',
    description:
      'Requests explicit user confirmation before any sensitive action such as sending a message, making a call, deleting a file, or making a purchase.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action_type: {
          type: Type.STRING,
          description: 'One of: "send_message", "make_call", "delete_file", "purchase", "other".',
        },
        summary: {
          type: Type.STRING,
          description: 'Clear description of the sensitive action requiring explicit confirmation.',
        },
      },
      required: ['action_type', 'summary'],
    },
  },
];

export interface ExecutedToolOutcome {
  result: CommandResult;
  screenshotBase64?: string;
}

export async function executeAssistantToolCallWithMedia(
  name: string,
  args: Record<string, unknown> = {}
): Promise<ExecutedToolOutcome> {
  switch (name) {
    case 'open_application':
      return { result: await openWindowsApp(args.app) };
    case 'open_website':
      return { result: await openSafeWebsite(args.url) };
    case 'search_google':
      return { result: await searchGoogle(args.query) };
    case 'get_current_datetime':
      return { result: getCurrentDateTime() };
    case 'adjust_volume':
      return { result: await adjustWindowsVolume(args.action, args.steps) };
    case 'control_flashlight':
      return { result: await controlWindowsFlashlight(args.state) };
    case 'capture_screen': {
      const captured = await captureDesktopScreen();
      recordAudit(captured.commandResult);
      return {
        result: captured.commandResult,
        screenshotBase64: captured.screenshotBase64,
      };
    }
    case 'mouse_action':
      return { result: recordAudit(await performMouseAction(args)) };
    case 'keyboard_type':
      return { result: recordAudit(await performKeyboardType(args)) };
    case 'keyboard_shortcut':
      return { result: recordAudit(await performKeyboardShortcut(args)) };
    case 'window_control':
      return { result: recordAudit(await controlWindowsWindow(args)) };
    case 'open_map_location': {
      const query = String(args.query ?? '').trim();
      const origin = typeof args.origin === 'string' && args.origin.trim() ? args.origin.trim() : undefined;
      const destination =
        typeof args.destination === 'string' && args.destination.trim()
          ? args.destination.trim()
          : undefined;
      const rawMode = String(args.travel_mode ?? 'DRIVING').toUpperCase();
      const travelMode =
        rawMode === 'WALKING' || rawMode === 'BICYCLING' || rawMode === 'TRANSIT'
          ? rawMode
          : 'DRIVING';
      const summaryText = destination
        ? `Opened Map & Places for route ${origin ? `from "${origin}" ` : ''}to "${destination}".`
        : `Opened Map & Places for "${query || 'location search'}".`;
      return {
        result: recordAudit({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          command: 'open_map_location',
          status: 'executed',
          summary: summaryText,
          details: 'Interactive Google Maps view synchronized.',
          mapRequest: {
            query: query || destination || '',
            origin,
            destination,
            travelMode,
          },
          timestamp: new Date().toISOString(),
          platform: process.platform,
        }),
      };
    }
    case 'request_sensitive_confirmation': {
      const { commandResult } = createSensitiveConfirmation(args.action_type, args.summary);
      return { result: commandResult };
    }
    default:
      return {
        result: {
          id: `${Date.now()}`,
          command: 'open_application',
          status: 'blocked',
          summary: `Blocked unknown command "${name}".`,
          timestamp: new Date().toISOString(),
          platform: process.platform,
        },
      };
  }
}

export async function executeAssistantToolCall(
  name: string,
  args: Record<string, unknown> = {}
): Promise<CommandResult> {
  const outcome = await executeAssistantToolCallWithMedia(name, args);
  return outcome.result;
}

export function formatGeminiError(err: unknown): { status: number; message: string } {
  let raw = '';
  if (err instanceof Error) {
    raw = err.message;
  } else if (err && typeof err === 'object') {
    const obj = err as {
      message?: unknown;
      reason?: unknown;
      error?: { message?: unknown };
    };
    if (typeof obj.message === 'string' && obj.message.trim()) {
      raw = obj.message;
    } else if (obj.error && typeof obj.error.message === 'string' && obj.error.message.trim()) {
      raw = obj.error.message;
    } else if (typeof obj.reason === 'string' && obj.reason.trim()) {
      raw = obj.reason;
    } else {
      try {
        raw = JSON.stringify(obj);
      } catch {
        raw = 'Unknown Gemini Live error';
      }
    }
  } else {
    raw = String(err ?? '');
  }

  // Unwrap nested JSON error envelopes returned by the API
  let parsedStatus: number | null = null;
  if (raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { error?: { code?: number; message?: string; status?: string } };
      if (parsed?.error?.message) {
        parsedStatus = typeof parsed.error.code === 'number' ? parsed.error.code : null;
        raw = parsed.error.message;
      }
    } catch {
      // Keep raw text if not valid JSON
    }
  }

  if (raw.includes('GEMINI_API_KEY')) {
    return {
      status: 503,
      message: 'Gemini API key is missing. Add GEMINI_API_KEY in Settings > Secrets or your .env file.',
    };
  }
  if (
    parsedStatus === 503 ||
    raw.includes('503') ||
    raw.includes('UNAVAILABLE') ||
    raw.toLowerCase().includes('high demand')
  ) {
    return {
      status: 503,
      message: 'Gemini is temporarily experiencing high demand. Please retry in a few seconds.',
    };
  }
  if (raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID') || raw.includes('403') || raw.includes('400')) {
    return {
      status: 400,
      message: `Gemini API request rejected (${raw}). Verify GEMINI_API_KEY or configuration.`,
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message: 'Gemini API rate limit reached. Please wait a moment and try again.',
    };
  }
  if (raw.includes('NOT_FOUND') || raw.includes('404')) {
    return {
      status: 404,
      message: `Requested Gemini Live endpoint/model returned 404 (${raw}).`,
    };
  }
  return {
    status: 500,
    message: raw || 'Unexpected server error communicating with Gemini API.',
  };
}
