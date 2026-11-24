import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AssistantSettings,
  AssistantStatus,
  CommandResult,
  ConnectionState,
  TranscriptMessage,
} from '../types/assistant';
import {
  base64Pcm24kToAudioBuffer,
  computeRmsLevel,
  float32ToInt16Base64,
} from '../utils/audioPcm';
import { detectSpokenLanguage } from '../utils/languageDetect';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionInstanceLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface UseVoiceAssistantOptions {
  settings: AssistantSettings;
  onCommandResult?: (result: CommandResult) => void;
  onSessionUpdate?: (messages: TranscriptMessage[]) => void;
}

interface PendingToolRef {
  toolCallId?: string;
  toolName?: string;
}

export function useVoiceAssistant({
  settings,
  onCommandResult,
  onSessionUpdate,
}: UseVoiceAssistantOptions) {
  const [status, setStatus] = useState<AssistantStatus>('idle');
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [micPermission, setMicPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [inputLevel, setInputLevel] = useState<number>(0);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [interimUserText, setInterimUserText] = useState<string>('');
  const [interimAssistantText, setInterimAssistantText] = useState<string>('');
  const [pushToTalkActive, setPushToTalkActive] = useState<boolean>(false);
  const [wakeListenerSupported, setWakeListenerSupported] = useState<boolean>(true);
  const [wakeDetectedFlash, setWakeDetectedFlash] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const isMutedInputRef = useRef<boolean>(false);
  const shouldKeepAliveRef = useRef<boolean>(false);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const settingsRef = useRef<AssistantSettings>(settings);
  const interimUserRef = useRef<string>('');
  const interimAssistantRef = useRef<string>('');
  const pendingToolCallsRef = useRef<Map<string, PendingToolRef>>(new Map());
  const wakeRecognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null);
  const statusRef = useRef<AssistantStatus>('idle');

  useEffect(() => {
    const prev = settingsRef.current;
    const sessionNeedsRefresh =
      prev.language !== settings.language ||
      prev.voiceName !== settings.voiceName ||
      prev.systemPrompt !== settings.systemPrompt;

    settingsRef.current = settings;

    if (
      sessionNeedsRefresh &&
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN
    ) {
      wsRef.current.send(
        JSON.stringify({
          type: 'init',
          language: settings.language,
          voiceName: settings.voiceName,
          systemPrompt: settings.systemPrompt,
        })
      );
    }
  }, [settings]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    onSessionUpdate?.(messages);
  }, [messages, onSessionUpdate]);

  const appendMessage = useCallback((msg: TranscriptMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const stopAllPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Already stopped
      }
    }
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
  }, []);

  const commitInterimUser = useCallback(() => {
    const text = interimUserRef.current.trim();
    if (text) {
      appendMessage({
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        text,
        detectedLanguage: detectSpokenLanguage(text, settingsRef.current.language),
        timestamp: new Date().toISOString(),
      });
    }
    interimUserRef.current = '';
    setInterimUserText('');
  }, [appendMessage]);

  const commitInterimAssistant = useCallback(() => {
    const text = interimAssistantRef.current.trim();
    if (text) {
      appendMessage({
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        text,
        detectedLanguage: detectSpokenLanguage(text, settingsRef.current.language),
        timestamp: new Date().toISOString(),
      });
    }
    interimAssistantRef.current = '';
    setInterimAssistantText('');
  }, [appendMessage]);

  const cleanupAudioPipeline = useCallback(() => {
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // Ignore disconnect error
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
    setInputLevel(0);
  }, []);

  const stopLiveSession = useCallback(
    (preserveWake = true) => {
      shouldKeepAliveRef.current = false;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      commitInterimUser();
      commitInterimAssistant();
      stopAllPlayback();
      cleanupAudioPipeline();

      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // Ignore close error
        }
        wsRef.current = null;
      }

      setConnectionState('disconnected');
      setPushToTalkActive(false);
      setStatus(preserveWake && settingsRef.current.wakeWordEnabled ? 'wake_armed' : 'idle');
    },
    [cleanupAudioPipeline, commitInterimAssistant, commitInterimUser, stopAllPlayback]
  );

  const playPcmChunk = useCallback((base64Data: string) => {
    if (!outputCtxRef.current || outputCtxRef.current.state === 'closed') {
      outputCtxRef.current = new AudioContext({ sampleRate: 24000 });
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    }
    const ctx = outputCtxRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const audioBuffer = base64Pcm24kToAudioBuffer(ctx, base64Data);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const startTime = Math.max(ctx.currentTime + 0.02, nextStartTimeRef.current);
    source.start(startTime);
    nextStartTimeRef.current = startTime + audioBuffer.duration;

    activeSourcesRef.current.add(source);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0 && shouldKeepAliveRef.current) {
        setStatus(isMutedInputRef.current ? 'idle' : 'listening');
      }
    };
  }, []);

  const startLiveSession = useCallback(
    async (options?: { startMuted?: boolean }) => {
      setErrorMessage(null);
      shouldKeepAliveRef.current = true;
      isMutedInputRef.current = Boolean(options?.startMuted);

      // Pause wake-word SpeechRecognition while Live mic stream is active
      if (wakeRecognitionRef.current) {
        try {
          wakeRecognitionRef.current.stop();
        } catch {
          // Ignore stop error
        }
      }

      setStatus('connecting');
      setConnectionState(reconnectAttemptsRef.current > 0 ? 'reconnecting' : 'connecting');

      let stream: MediaStream;
      try {
        const audioConstraint: MediaTrackConstraints =
          settingsRef.current.selectedMicId && settingsRef.current.selectedMicId !== 'default'
            ? {
                deviceId: { exact: settingsRef.current.selectedMicId },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              }
            : {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              };
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
        setMicPermission('granted');
      } catch (err) {
        setMicPermission('denied');
        shouldKeepAliveRef.current = false;
        setConnectionState('error');
        setStatus('error');
        setErrorMessage(
          err instanceof Error
            ? `Microphone access failed: ${err.message}. Grant microphone permission in Windows 11 and your browser.`
            : 'Microphone permission was denied.'
        );
        return;
      }

      mediaStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      inputCtxRef.current = inputCtx;
      if (!outputCtxRef.current || outputCtxRef.current.state === 'closed') {
        outputCtxRef.current = new AudioContext({ sampleRate: 24000 });
      }
      nextStartTimeRef.current = outputCtxRef.current.currentTime;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setConnectionState('connected');
        ws.send(
          JSON.stringify({
            type: 'init',
            language: settingsRef.current.language,
            voiceName: settingsRef.current.voiceName,
            systemPrompt: settingsRef.current.systemPrompt,
          })
        );
      };

      ws.onmessage = (event) => {
        let payload: {
          type: string;
          data?: string;
          text?: string;
          message?: string;
          result?: CommandResult;
          toolCallId?: string;
          toolName?: string;
        };
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (payload.type) {
          case 'session_ready': {
            setStatus(isMutedInputRef.current ? 'idle' : 'listening');
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
              const channelData = e.inputBuffer.getChannelData(0);
              const level = computeRmsLevel(channelData);
              setInputLevel(isMutedInputRef.current ? 0 : level);

              if (isMutedInputRef.current) return;
              const base64 = float32ToInt16Base64(channelData);
              wsRef.current.send(JSON.stringify({ type: 'audio', data: base64 }));
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
            break;
          }

          case 'input_transcript': {
            if (payload.text) {
              interimUserRef.current += payload.text;
              setInterimUserText(interimUserRef.current);
              if (activeSourcesRef.current.size === 0) {
                setStatus('processing');
              }
            }
            break;
          }

          case 'output_transcript': {
            commitInterimUser();
            if (payload.text) {
              interimAssistantRef.current += payload.text;
              setInterimAssistantText(interimAssistantRef.current);
            }
            break;
          }

          case 'audio': {
            commitInterimUser();
            if (payload.data) {
              setStatus('speaking');
              playPcmChunk(payload.data);
            }
            break;
          }

          case 'interrupted': {
            stopAllPlayback();
            commitInterimAssistant();
            setStatus(isMutedInputRef.current ? 'idle' : 'listening');
            break;
          }

          case 'turn_complete': {
            commitInterimUser();
            commitInterimAssistant();
            if (activeSourcesRef.current.size === 0 && shouldKeepAliveRef.current) {
              setStatus(isMutedInputRef.current ? 'idle' : 'listening');
            }
            break;
          }

          case 'command_result': {
            if (payload.result) {
              if (payload.result.confirmationId) {
                pendingToolCallsRef.current.set(payload.result.confirmationId, {
                  toolCallId: payload.toolCallId,
                  toolName: payload.toolName,
                });
              }
              onCommandResult?.(payload.result);
              appendMessage({
                id: `cmd-${payload.result.id}`,
                role: 'system',
                text: payload.result.summary,
                timestamp: payload.result.timestamp,
                commandResult: payload.result,
              });
            }
            break;
          }

          case 'error': {
            setErrorMessage(payload.message || 'Live voice session encountered an error.');
            setConnectionState('error');
            setStatus('error');
            break;
          }

          case 'session_closed': {
            if (shouldKeepAliveRef.current && settingsRef.current.autoReconnect) {
              setConnectionState('reconnecting');
            }
            break;
          }
        }
      };

      ws.onerror = () => {
        setConnectionState('error');
        setErrorMessage('WebSocket connection error. Checking reconnection...');
      };

      ws.onclose = () => {
        cleanupAudioPipeline();
        if (shouldKeepAliveRef.current && settingsRef.current.autoReconnect) {
          const attempt = reconnectAttemptsRef.current + 1;
          reconnectAttemptsRef.current = attempt;
          if (attempt <= 5) {
            const delayMs = Math.min(8000, 1000 * 2 ** (attempt - 1));
            setConnectionState('reconnecting');
            setStatus('connecting');
            reconnectTimerRef.current = window.setTimeout(() => {
              if (shouldKeepAliveRef.current) {
                startLiveSession({ startMuted: isMutedInputRef.current });
              }
            }, delayMs);
            return;
          }
        }
        setConnectionState('disconnected');
        if (shouldKeepAliveRef.current) {
          shouldKeepAliveRef.current = false;
          setStatus('error');
          setErrorMessage('Disconnected from Live voice server. Click the microphone to reconnect.');
        } else {
          setStatus(settingsRef.current.wakeWordEnabled ? 'wake_armed' : 'idle');
        }
      };
    },
    [
      appendMessage,
      cleanupAudioPipeline,
      commitInterimAssistant,
      commitInterimUser,
      onCommandResult,
      playPcmChunk,
      stopAllPlayback,
    ]
  );

  const toggleListening = useCallback(() => {
    if (
      status === 'listening' ||
      status === 'speaking' ||
      status === 'processing' ||
      status === 'connecting'
    ) {
      stopLiveSession(true);
    } else {
      startLiveSession({ startMuted: false });
    }
  }, [startLiveSession, status, stopLiveSession]);

  const interruptAssistant = useCallback(() => {
    stopAllPlayback();
    commitInterimAssistant();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
    if (shouldKeepAliveRef.current) {
      setStatus(isMutedInputRef.current ? 'idle' : 'listening');
    } else {
      setStatus(settingsRef.current.wakeWordEnabled ? 'wake_armed' : 'idle');
    }
  }, [commitInterimAssistant, stopAllPlayback]);

  const startPushToTalk = useCallback(async () => {
    setPushToTalkActive(true);
    // Interrupt assistant immediately if speaking so user can talk over
    if (activeSourcesRef.current.size > 0) {
      interruptAssistant();
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      await startLiveSession({ startMuted: false });
    } else {
      isMutedInputRef.current = false;
      setStatus('listening');
    }
  }, [interruptAssistant, startLiveSession]);

  const stopPushToTalk = useCallback(() => {
    setPushToTalkActive(false);
    isMutedInputRef.current = true;
    setInputLevel(0);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setStatus('processing');
    }
  }, []);

  const sendTextMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setErrorMessage(null);

      // Interrupt any active speech when user submits a new prompt
      if (activeSourcesRef.current.size > 0) {
        interruptAssistant();
      }

      const userMsg: TranscriptMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: trimmed,
        detectedLanguage: detectSpokenLanguage(trimmed, settingsRef.current.language),
        timestamp: new Date().toISOString(),
      };
      appendMessage(userMsg);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        setStatus('processing');
        wsRef.current.send(JSON.stringify({ type: 'text', text: trimmed }));
        return;
      }

      setStatus('processing');
      try {
        const historyPayload = messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text }));

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmed,
            history: historyPayload,
            language: settingsRef.current.language,
            systemPrompt: settingsRef.current.systemPrompt,
          }),
        });

        const data = (await res.json()) as {
          reply?: string;
          commandResults?: CommandResult[];
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || 'Failed to reach Gemini assistant API.');
        }

        for (const cmdResult of data.commandResults ?? []) {
          onCommandResult?.(cmdResult);
          appendMessage({
            id: `cmd-${cmdResult.id}`,
            role: 'system',
            text: cmdResult.summary,
            timestamp: cmdResult.timestamp,
            commandResult: cmdResult,
          });
        }

        if (data.reply) {
          appendMessage({
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: data.reply,
            detectedLanguage: detectSpokenLanguage(data.reply, settingsRef.current.language),
            timestamp: new Date().toISOString(),
          });
        }
        setStatus(settingsRef.current.wakeWordEnabled ? 'wake_armed' : 'idle');
      } catch (err) {
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Unable to send message.');
      }
    },
    [appendMessage, interruptAssistant, messages, onCommandResult]
  );

  const confirmSensitiveAction = useCallback(
    async (confirmationId: string, decision: 'approved' | 'rejected') => {
      const toolMeta = pendingToolCallsRef.current.get(confirmationId);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && toolMeta) {
        wsRef.current.send(
          JSON.stringify({
            type: 'confirm_action',
            confirmationId,
            decision,
            toolCallId: toolMeta.toolCallId,
            toolName: toolMeta.toolName,
          })
        );
        pendingToolCallsRef.current.delete(confirmationId);
        return;
      }

      try {
        const res = await fetch('/api/commands/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmationId, decision }),
        });
        const data = (await res.json()) as { commandResult?: CommandResult };
        if (data.commandResult) {
          onCommandResult?.(data.commandResult);
          appendMessage({
            id: `confirm-${Date.now()}`,
            role: 'system',
            text: data.commandResult.summary,
            timestamp: data.commandResult.timestamp,
            commandResult: data.commandResult,
          });
        }
      } catch {
        setErrorMessage('Failed to submit confirmation decision.');
      }
    },
    [appendMessage, onCommandResult]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    interimUserRef.current = '';
    interimAssistantRef.current = '';
    setInterimUserText('');
    setInterimAssistantText('');
  }, []);

  const loadSessionMessages = useCallback((loaded: TranscriptMessage[]) => {
    setMessages(loaded);
  }, []);

  // Wake phrase ("Hey Assistant") continuous recognition when armed and not in active Live mic stream
  useEffect(() => {
    const SpeechRecCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstanceLike })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstanceLike })
        .webkitSpeechRecognition;

    if (!SpeechRecCtor) {
      setWakeListenerSupported(false);
      return;
    }
    setWakeListenerSupported(true);

    const isLiveActive =
      status === 'listening' ||
      status === 'speaking' ||
      status === 'processing' ||
      status === 'connecting';

    if (!settings.wakeWordEnabled || isLiveActive) {
      if (wakeRecognitionRef.current) {
        try {
          wakeRecognitionRef.current.stop();
        } catch {
          // Ignore
        }
        wakeRecognitionRef.current = null;
      }
      if (!settings.wakeWordEnabled && status === 'wake_armed') {
        setStatus('idle');
      }
      return;
    }

    if (status === 'idle') {
      setStatus('wake_armed');
    }

    let cancelled = false;
    const recognition = new SpeechRecCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang =
      settings.language === 'tl'
        ? 'fil-PH'
        : settings.language === 'ceb'
          ? 'ceb-PH'
          : 'en-US';

    const targetPhrase = (settings.wakePhrase || 'hey assistant').toLowerCase().trim();

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript?.toLowerCase() ?? '';
        if (
          transcript.includes(targetPhrase) ||
          transcript.includes('hey assistant') ||
          transcript.includes('a assistant')
        ) {
          setWakeDetectedFlash(true);
          window.setTimeout(() => setWakeDetectedFlash(false), 1800);
          try {
            recognition.stop();
          } catch {
            // Ignore
          }
          if (!cancelled && statusRef.current === 'wake_armed') {
            startLiveSession({ startMuted: false });
          }
          break;
        }
      }
    };

    recognition.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        setMicPermission('denied');
      }
    };

    recognition.onend = () => {
      if (!cancelled && settingsRef.current.wakeWordEnabled && statusRef.current === 'wake_armed') {
        window.setTimeout(() => {
          if (!cancelled && statusRef.current === 'wake_armed') {
            try {
              recognition.start();
            } catch {
              // Already started
            }
          }
        }, 450);
      }
    };

    try {
      recognition.start();
      wakeRecognitionRef.current = recognition;
    } catch {
      // Ignore start race
    }

    return () => {
      cancelled = true;
      try {
        recognition.stop();
      } catch {
        // Ignore
      }
      wakeRecognitionRef.current = null;
    };
  }, [settings.language, settings.wakePhrase, settings.wakeWordEnabled, startLiveSession, status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldKeepAliveRef.current = false;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      stopAllPlayback();
      cleanupAudioPipeline();
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (outputCtxRef.current && outputCtxRef.current.state !== 'closed') {
        outputCtxRef.current.close().catch(() => {});
      }
    };
  }, [cleanupAudioPipeline, stopAllPlayback]);

  return {
    status,
    connectionState,
    errorMessage,
    setErrorMessage,
    micPermission,
    inputLevel,
    messages,
    interimUserText,
    interimAssistantText,
    pushToTalkActive,
    wakeListenerSupported,
    wakeDetectedFlash,
    toggleListening,
    startLiveSession,
    stopLiveSession,
    interruptAssistant,
    startPushToTalk,
    stopPushToTalk,
    sendTextMessage,
    confirmSensitiveAction,
    clearMessages,
    loadSessionMessages,
  };
}
