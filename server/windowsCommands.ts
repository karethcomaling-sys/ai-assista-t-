import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type {
  CommandResult,
  PendingConfirmation,
  SensitiveActionType,
} from '../src/types/assistant.ts';

const execFileAsync = promisify(execFile);

const pendingConfirmations = new Map<string, PendingConfirmation>();
const commandAuditLog: CommandResult[] = [];

let simulatedVolumeLevel = 50;
let flashlightState: 'on' | 'off' = 'off';

export function recordAudit(entry: CommandResult): CommandResult {
  const sanitizedForLog: CommandResult = entry.screenshotDataUrl
    ? { ...entry, screenshotDataUrl: undefined }
    : entry;
  commandAuditLog.unshift(sanitizedForLog);
  if (commandAuditLog.length > 100) {
    commandAuditLog.length = 100;
  }
  return entry;
}

export function getCommandAuditLog(): CommandResult[] {
  return [...commandAuditLog];
}

export function getPendingConfirmations(): PendingConfirmation[] {
  return Array.from(pendingConfirmations.values()).filter((c) => c.status === 'pending');
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower === '0.0.0.0' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  // Block private IPv4 ranges and link-local metadata endpoints
  if (/^10\./.test(lower) || /^192\.168\./.test(lower) || /^169\.254\./.test(lower)) {
    return true;
  }
  const match172 = lower.match(/^172\.(\d+)\./);
  if (match172) {
    const second = Number(match172[1]);
    if (second >= 16 && second <= 31) {
      return true;
    }
  }
  return false;
}

export function validateExternalUrl(rawUrl: string): { valid: boolean; normalizedUrl?: string; reason?: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, reason: 'URL cannot be empty.' };
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, reason: 'Only http:// and https:// URLs are permitted.' };
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return { valid: false, reason: 'Please provide a valid public domain name.' };
    }
    if (isPrivateOrLoopbackHost(parsed.hostname)) {
      return { valid: false, reason: 'Localhost and private network URLs are blocked for safety.' };
    }
    return { valid: true, normalizedUrl: parsed.toString() };
  } catch {
    return { valid: false, reason: 'Invalid URL format.' };
  }
}

export async function probeWindowsFlashlight(): Promise<{ supported: boolean; reason: string }> {
  if (process.platform !== 'win32') {
    return {
      supported: false,
      reason: 'Flashlight hardware check requires Windows 11 with a compatible camera torch device.',
    };
  }
  try {
    // Fixed, non-interpolated PowerShell check for WinRT Lamp hardware instance
    const script =
      'Add-Type -AssemblyName System.Runtime.WindowsRuntime; ' +
      '$null = [Windows.Devices.Lights.Lamp, Windows.Devices.Lights, ContentType=WindowsRuntime]; ' +
      '$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation`1" })[0]; ' +
      '$op = [Windows.Devices.Lights.Lamp]::GetDefaultAsync(); ' +
      '$netTask = $asTaskGeneric.MakeGenericMethod([Windows.Devices.Lights.Lamp]).Invoke($null, @($op)); ' +
      '$netTask.Wait(2000) | Out-Null; ' +
      '$lamp = $netTask.Result; ' +
      'if ($null -ne $lamp) { $lamp.Dispose(); "AVAILABLE" } else { "NONE" }';
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 4000 }
    );
    if (stdout.trim().includes('AVAILABLE')) {
      return {
        supported: true,
        reason: 'Compatible Windows Lamp device interface detected.',
      };
    }
    return {
      supported: false,
      reason: 'No compatible flashlight or torch hardware was detected on this Windows 11 PC.',
    };
  } catch {
    return {
      supported: false,
      reason: 'No compatible flashlight or torch hardware was detected on this Windows 11 PC.',
    };
  }
}

function launchWindowsDetached(executable: string, args: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
    });
    child.on('error', (err) => reject(err));
    child.unref();
    resolve();
  });
}

export async function openWindowsApp(appName: unknown): Promise<CommandResult> {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const normalized = typeof appName === 'string' ? appName.trim().toLowerCase() : '';

  const allowlist: Record<string, { exe: string; label: string }> = {
    notepad: { exe: 'notepad.exe', label: 'Notepad' },
    calculator: { exe: 'calc.exe', label: 'Calculator' },
    calc: { exe: 'calc.exe', label: 'Calculator' },
    chrome: { exe: 'chrome.exe', label: 'Google Chrome' },
  };

  const target = allowlist[normalized];
  if (!target) {
    return recordAudit({
      id,
      command: 'open_application',
      status: 'blocked',
      summary: `Blocked unrecognized application "${String(appName)}".`,
      details: 'Only allowlisted apps (Notepad, Calculator, Chrome) can be opened.',
      timestamp,
      platform: process.platform,
    });
  }

  if (process.platform === 'win32') {
    try {
      await launchWindowsDetached(target.exe);
      return recordAudit({
        id,
        command: 'open_application',
        status: 'executed',
        summary: `Opened ${target.label} on Windows 11.`,
        timestamp,
        platform: process.platform,
      });
    } catch (err) {
      // Fallback for Chrome via Windows shell handler if chrome.exe is not on PATH
      if (target.exe === 'chrome.exe') {
        try {
          await launchWindowsDetached('cmd.exe', ['/c', 'start', '', 'chrome']);
          return recordAudit({
            id,
            command: 'open_application',
            status: 'executed',
            summary: `Opened ${target.label} on Windows 11.`,
            timestamp,
            platform: process.platform,
          });
        } catch {
          // Fall through to error return
        }
      }
      return recordAudit({
        id,
        command: 'open_application',
        status: 'unsupported',
        summary: `Could not launch ${target.label}.`,
        details: err instanceof Error ? err.message : 'Executable unavailable on PATH.',
        timestamp,
        platform: process.platform,
      });
    }
  }

  return recordAudit({
    id,
    command: 'open_application',
    status: 'preview_only',
    summary: `Prepared Windows 11 launch for ${target.label} (${target.exe}).`,
    details: 'Running in browser preview host; native launch executes automatically when running locally on Windows 11.',
    timestamp,
    platform: process.platform,
  });
}

export async function openSafeWebsite(rawUrl: unknown): Promise<CommandResult> {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  if (typeof rawUrl !== 'string') {
    return recordAudit({
      id,
      command: 'open_website',
      status: 'blocked',
      summary: 'Website URL must be a text string.',
      timestamp,
      platform: process.platform,
    });
  }

  const check = validateExternalUrl(rawUrl);
  if (!check.valid || !check.normalizedUrl) {
    return recordAudit({
      id,
      command: 'open_website',
      status: 'blocked',
      summary: 'Blocked unsafe or invalid website URL.',
      details: check.reason,
      timestamp,
      platform: process.platform,
    });
  }

  if (process.platform === 'win32') {
    try {
      await launchWindowsDetached('rundll32.exe', ['url.dll,FileProtocolHandler', check.normalizedUrl]);
      return recordAudit({
        id,
        command: 'open_website',
        status: 'executed',
        summary: `Opened ${check.normalizedUrl} in your default browser.`,
        launchUrl: check.normalizedUrl,
        timestamp,
        platform: process.platform,
      });
    } catch (err) {
      return recordAudit({
        id,
        command: 'open_website',
        status: 'unsupported',
        summary: `Failed to open ${check.normalizedUrl} on Windows.`,
        details: err instanceof Error ? err.message : 'Browser launch error.',
        launchUrl: check.normalizedUrl,
        timestamp,
        platform: process.platform,
      });
    }
  }

  return recordAudit({
    id,
    command: 'open_website',
    status: 'preview_only',
    summary: `Ready to open ${check.normalizedUrl}.`,
    details: 'Click the verified link card in the transcript or run locally on Windows 11 for automatic browser launch.',
    launchUrl: check.normalizedUrl,
    timestamp,
    platform: process.platform,
  });
}

export async function searchGoogle(rawQuery: unknown): Promise<CommandResult> {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';

  if (!query || query.length > 300) {
    return recordAudit({
      id,
      command: 'search_google',
      status: 'blocked',
      summary: 'Search query must be between 1 and 300 characters.',
      timestamp,
      platform: process.platform,
    });
  }

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  if (process.platform === 'win32') {
    try {
      await launchWindowsDetached('rundll32.exe', ['url.dll,FileProtocolHandler', searchUrl]);
      return recordAudit({
        id,
        command: 'search_google',
        status: 'executed',
        summary: `Searched Google for "${query}".`,
        launchUrl: searchUrl,
        timestamp,
        platform: process.platform,
      });
    } catch (err) {
      return recordAudit({
        id,
        command: 'search_google',
        status: 'unsupported',
        summary: `Prepared Google search for "${query}".`,
        details: err instanceof Error ? err.message : 'Browser launch error.',
        launchUrl: searchUrl,
        timestamp,
        platform: process.platform,
      });
    }
  }

  return recordAudit({
    id,
    command: 'search_google',
    status: 'preview_only',
    summary: `Google search ready for "${query}".`,
    details: 'Open the verified search link in the transcript or run locally on Windows 11.',
    launchUrl: searchUrl,
    timestamp,
    platform: process.platform,
  });
}

export function getCurrentDateTime(): CommandResult & { formattedDate: string; formattedTime: string } {
  const now = new Date();
  const formattedDate = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';

  const result = recordAudit({
    id: crypto.randomUUID(),
    command: 'get_current_datetime',
    status: 'executed',
    summary: `${formattedTime} · ${formattedDate} (${timezone})`,
    timestamp: now.toISOString(),
    platform: process.platform,
  });

  return { ...result, formattedDate, formattedTime };
}

export async function adjustWindowsVolume(action: unknown, stepsRaw?: unknown): Promise<CommandResult> {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const validActions = ['increase', 'decrease', 'mute', 'unmute'] as const;
  const normalized = typeof action === 'string' ? action.trim().toLowerCase() : '';

  if (!validActions.includes(normalized as (typeof validActions)[number])) {
    return recordAudit({
      id,
      command: 'adjust_volume',
      status: 'blocked',
      summary: `Unsupported volume action "${String(action)}".`,
      timestamp,
      platform: process.platform,
    });
  }

  const parsedSteps = typeof stepsRaw === 'number' && Number.isFinite(stepsRaw) ? Math.round(stepsRaw) : 5;
  const boundedSteps = Math.min(20, Math.max(1, parsedSteps));

  if (process.platform === 'win32') {
    try {
      // Uses Windows WScript.Shell virtual media key codes (175=VolUp, 174=VolDown, 173=Mute)
      const keyChar = normalized === 'increase' ? 175 : normalized === 'decrease' ? 174 : 173;
      const repeatCount = normalized === 'mute' || normalized === 'unmute' ? 1 : boundedSteps;
      const psScript = `$w = New-Object -ComObject WScript.Shell; 1..${repeatCount} | ForEach-Object { $w.SendKeys([char]${keyChar}) }`;
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { timeout: 3000 }
      );
      return recordAudit({
        id,
        command: 'adjust_volume',
        status: 'executed',
        summary:
          normalized === 'increase'
            ? `Increased Windows system volume by ${boundedSteps} steps.`
            : normalized === 'decrease'
              ? `Decreased Windows system volume by ${boundedSteps} steps.`
              : `Toggled Windows system mute (${normalized}).`,
        timestamp,
        platform: process.platform,
      });
    } catch (err) {
      return recordAudit({
        id,
        command: 'adjust_volume',
        status: 'unsupported',
        summary: 'Unable to adjust Windows volume automatically.',
        details: err instanceof Error ? err.message : 'PowerShell audio key dispatch failed.',
        timestamp,
        platform: process.platform,
      });
    }
  }

  if (normalized === 'increase') {
    simulatedVolumeLevel = Math.min(100, simulatedVolumeLevel + boundedSteps * 2);
  } else if (normalized === 'decrease') {
    simulatedVolumeLevel = Math.max(0, simulatedVolumeLevel - boundedSteps * 2);
  } else if (normalized === 'mute') {
    simulatedVolumeLevel = 0;
  } else if (normalized === 'unmute' && simulatedVolumeLevel === 0) {
    simulatedVolumeLevel = 50;
  }

  return recordAudit({
    id,
    command: 'adjust_volume',
    status: 'preview_only',
    summary: `Volume ${normalized} registered (preview level: ${simulatedVolumeLevel}%).`,
    details: 'Native Windows 11 volume control runs when hosted locally on Windows.',
    timestamp,
    platform: process.platform,
  });
}

export async function controlWindowsFlashlight(stateRaw: unknown): Promise<CommandResult> {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const desired = typeof stateRaw === 'string' && stateRaw.trim().toLowerCase() === 'on' ? 'on' : 'off';

  const probe = await probeWindowsFlashlight();
  if (!probe.supported) {
    return recordAudit({
      id,
      command: 'control_flashlight',
      status: 'unsupported',
      summary: 'Flashlight unavailable on this device.',
      details: probe.reason,
      timestamp,
      platform: process.platform,
    });
  }

  if (process.platform === 'win32') {
    try {
      const enabledLiteral = desired === 'on' ? '$true' : '$false';
      const toggleScript =
        'Add-Type -AssemblyName System.Runtime.WindowsRuntime; ' +
        '$null = [Windows.Devices.Lights.Lamp, Windows.Devices.Lights, ContentType=WindowsRuntime]; ' +
        '$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation`1" })[0]; ' +
        '$op = [Windows.Devices.Lights.Lamp]::GetDefaultAsync(); ' +
        '$netTask = $asTaskGeneric.MakeGenericMethod([Windows.Devices.Lights.Lamp]).Invoke($null, @($op)); ' +
        '$netTask.Wait(2000) | Out-Null; ' +
        '$lamp = $netTask.Result; ' +
        `if ($null -ne $lamp) { $lamp.IsEnabled = ${enabledLiteral}; "OK" } else { "NONE" }`;
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', toggleScript],
        { timeout: 4000 }
      );
      if (!stdout.includes('OK')) {
        return recordAudit({
          id,
          command: 'control_flashlight',
          status: 'unsupported',
          summary: 'Flashlight hardware did not respond.',
          timestamp,
          platform: process.platform,
        });
      }
    } catch (err) {
      return recordAudit({
        id,
        command: 'control_flashlight',
        status: 'unsupported',
        summary: 'Unable to control device flashlight.',
        details: err instanceof Error ? err.message : 'WinRT Lamp error.',
        timestamp,
        platform: process.platform,
      });
    }
  }

  flashlightState = desired;
  return recordAudit({
    id,
    command: 'control_flashlight',
    status: 'executed',
    summary: `Turned compatible device flashlight ${flashlightState}.`,
    timestamp,
    platform: process.platform,
  });
}

export function createSensitiveConfirmation(
  actionTypeRaw: unknown,
  summaryRaw: unknown
): { confirmation: PendingConfirmation; commandResult: CommandResult } {
  const allowedTypes: SensitiveActionType[] = [
    'send_message',
    'make_call',
    'delete_file',
    'purchase',
    'other',
  ];
  const actionType = allowedTypes.includes(actionTypeRaw as SensitiveActionType)
    ? (actionTypeRaw as SensitiveActionType)
    : 'other';

  const summary =
    typeof summaryRaw === 'string' && summaryRaw.trim().length > 0
      ? summaryRaw.trim().slice(0, 280)
      : `Confirm sensitive action (${actionType}).`;

  const confirmation: PendingConfirmation = {
    id: crypto.randomUUID(),
    actionType,
    summary,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  pendingConfirmations.set(confirmation.id, confirmation);

  const commandResult = recordAudit({
    id: crypto.randomUUID(),
    command: 'request_sensitive_confirmation',
    status: 'pending_confirmation',
    summary,
    details: 'Explicit user confirmation is required before proceeding with any sensitive action.',
    timestamp: confirmation.createdAt,
    platform: process.platform,
    confirmationId: confirmation.id,
    sensitiveActionType: actionType,
  });

  return { confirmation, commandResult };
}

export function resolveSensitiveConfirmation(
  confirmationId: string,
  decision: 'approved' | 'rejected'
): { found: boolean; confirmation?: PendingConfirmation; commandResult?: CommandResult } {
  const existing = pendingConfirmations.get(confirmationId);
  if (!existing) {
    return { found: false };
  }
  existing.status = decision;
  pendingConfirmations.set(confirmationId, existing);

  const commandResult = recordAudit({
    id: crypto.randomUUID(),
    command: 'request_sensitive_confirmation',
    status: decision === 'approved' ? 'executed' : 'cancelled',
    summary:
      decision === 'approved'
        ? `User explicitly confirmed: ${existing.summary}`
        : `User cancelled sensitive action: ${existing.summary}`,
    details:
      decision === 'approved'
        ? 'Action confirmed by user. No automated destructive execution is performed without explicit host integration.'
        : 'Action safely cancelled.',
    timestamp: new Date().toISOString(),
    platform: process.platform,
    confirmationId: existing.id,
    sensitiveActionType: existing.actionType,
  });

  return { found: true, confirmation: existing, commandResult };
}
