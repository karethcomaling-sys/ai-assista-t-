import type { Server as HttpServer } from 'node:http';
import { type LiveServerMessage, Modality } from '@google/genai';
import { type WebSocket, WebSocketServer } from 'ws';
import type { LanguagePreference, VoiceName } from '../src/types/assistant.ts';
import {
  buildSystemInstruction,
  executeAssistantToolCallWithMedia,
  formatGeminiError,
  getGeminiLiveClient,
  WINDOWS_TOOL_DECLARATIONS,
  withGeminiRetry,
} from './geminiClient.ts';
import { resolveSensitiveConfirmation } from './windowsCommands.ts';

interface LiveInitPayload {
  type: 'init';
  language?: LanguagePreference;
  voiceName?: VoiceName;
  systemPrompt?: string;
}

interface LiveAudioPayload {
  type: 'audio';
  data: string;
}

interface LiveTextPayload {
  type: 'text';
  text: string;
}

interface LiveConfirmationPayload {
  type: 'confirm_action';
  confirmationId: string;
  decision: 'approved' | 'rejected';
  toolCallId?: string;
  toolName?: string;
}

interface LiveInterruptPayload {
  type: 'interrupt';
}

type ClientLiveMessage =
  | LiveInitPayload
  | LiveAudioPayload
  | LiveTextPayload
  | LiveConfirmationPayload
  | LiveInterruptPayload;

function safeSend(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function attachLiveBridge(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/live' });

  wss.on('connection', (clientWs) => {
    let session: Awaited<ReturnType<ReturnType<typeof getGeminiLiveClient>['live']['connect']>> | null = null;
    let isClosing = false;

    const closeLiveSession = () => {
      if (session) {
        try {
          session.close();
        } catch {
          // Ignore close errors during teardown
        }
        session = null;
      }
    };

    clientWs.on('message', async (rawData) => {
      let msg: ClientLiveMessage;
      try {
        msg = JSON.parse(rawData.toString()) as ClientLiveMessage;
      } catch {
        safeSend(clientWs, { type: 'error', message: 'Invalid WebSocket JSON payload.' });
        return;
      }

      if (msg.type === 'init') {
        closeLiveSession();
        try {
          const ai = getGeminiLiveClient();
          const language: LanguagePreference = msg.language ?? 'auto';
          const voiceName: VoiceName = msg.voiceName ?? 'Zephyr';
          const systemInstruction = buildSystemInstruction(msg.systemPrompt, language);

          session = await withGeminiRetry(() =>
            ai.live.connect({
              model: 'gemini-3.8-live',
              config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              tools: [{ functionDeclarations: WINDOWS_TOOL_DECLARATIONS }],
              systemInstruction,
            },
            callbacks: {
              onopen: () => {
                if (!isClosing) {
                  safeSend(clientWs, { type: 'session_ready', model: 'gemini-3.8-live' });
                }
              },
              onmessage: async (message: LiveServerMessage) => {
                if (isClosing) return;

                const content = message.serverContent;

                if (content?.inputTranscription?.text) {
                  safeSend(clientWs, {
                    type: 'input_transcript',
                    text: content.inputTranscription.text,
                  });
                }

                if (content?.outputTranscription?.text) {
                  safeSend(clientWs, {
                    type: 'output_transcript',
                    text: content.outputTranscription.text,
                  });
                }

                for (const part of content?.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    safeSend(clientWs, {
                      type: 'audio',
                      data: part.inlineData.data,
                    });
                  }
                }

                if (content?.interrupted) {
                  safeSend(clientWs, { type: 'interrupted' });
                }

                if (content?.turnComplete) {
                  safeSend(clientWs, { type: 'turn_complete' });
                }

                for (const call of message.toolCall?.functionCalls ?? []) {
                  if (!call.name || !call.id) continue;
                  const { result, screenshotBase64 } = await executeAssistantToolCallWithMedia(
                    call.name,
                    (call.args as Record<string, unknown> | undefined) ?? {}
                  );
                  safeSend(clientWs, {
                    type: 'command_result',
                    toolCallId: call.id,
                    toolName: call.name,
                    result,
                  });

                  // Send captured desktop frame directly to Gemini Live vision channel
                  if (screenshotBase64 && session) {
                    session.sendRealtimeInput({
                      video: {
                        data: screenshotBase64,
                        mimeType: 'image/jpeg',
                      },
                    });
                  }

                  // Send tool response immediately unless pending confirmation requires user approval
                  if (result.status !== 'pending_confirmation' && session) {
                    session.sendToolResponse({
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: {
                            status: result.status,
                            summary: result.summary,
                            details: result.details ?? '',
                            launchUrl: result.launchUrl ?? '',
                            windowsList: result.windowsList ?? [],
                          },
                        },
                      ],
                    });
                  }
                }
              },
              onerror: (err) => {
                if (!isClosing) {
                  const formatted = formatGeminiError(err);
                  safeSend(clientWs, { type: 'error', message: formatted.message });
                }
              },
              onclose: () => {
                if (!isClosing) {
                  safeSend(clientWs, { type: 'session_closed' });
                }
              },
            },
            })
          );
        } catch (err) {
          const formatted = formatGeminiError(err);
          safeSend(clientWs, { type: 'error', message: formatted.message });
        }
        return;
      }

      if (msg.type === 'audio' && session) {
        try {
          session.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } catch (err) {
          const formatted = formatGeminiError(err);
          safeSend(clientWs, { type: 'error', message: formatted.message });
        }
        return;
      }

      if (msg.type === 'text' && session && msg.text.trim()) {
        try {
          session.sendRealtimeInput({
            text: msg.text.trim(),
          });
        } catch (err) {
          const formatted = formatGeminiError(err);
          safeSend(clientWs, { type: 'error', message: formatted.message });
        }
        return;
      }

      if (msg.type === 'confirm_action') {
        const resolved = resolveSensitiveConfirmation(msg.confirmationId, msg.decision);
        if (resolved.found && resolved.commandResult) {
          safeSend(clientWs, {
            type: 'command_result',
            result: resolved.commandResult,
          });
          if (session && msg.toolCallId && msg.toolName) {
            session.sendToolResponse({
              functionResponses: [
                {
                  id: msg.toolCallId,
                  name: msg.toolName,
                  response: {
                    status: resolved.commandResult.status,
                    summary: resolved.commandResult.summary,
                  },
                },
              ],
            });
          }
        }
        return;
      }

      if (msg.type === 'interrupt') {
        safeSend(clientWs, { type: 'interrupted' });
      }
    });

    clientWs.on('close', () => {
      isClosing = true;
      closeLiveSession();
    });
  });

  return wss;
}
