import type { Content } from '@google/genai';
import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import type {
  ConversationSession,
  LanguagePreference,
  WindowsCommandName,
} from './src/types/assistant.ts';
import {
  buildSystemInstruction,
  executeAssistantToolCall,
  formatGeminiError,
  getGeminiClient,
  WINDOWS_TOOL_DECLARATIONS,
  withGeminiRetry,
} from './server/geminiClient.ts';
import { attachLiveBridge } from './server/liveBridge.ts';
import {
  clearHistory,
  loadHistory,
  loadSettings,
  saveSettings,
  upsertHistorySession,
} from './server/storage.ts';
import {
  getCommandAuditLog,
  getCurrentDateTime,
  getPendingConfirmations,
  probeWindowsFlashlight,
  resolveSensitiveConfirmation,
} from './server/windowsCommands.ts';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'hey-assistant-ai',
      platform: process.platform,
      apiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
    });
  });

  app.get('/api/system-info', async (_req, res) => {
    const flashlight = await probeWindowsFlashlight();
    const dt = getCurrentDateTime();
    res.json({
      platform: process.platform,
      isWindows: process.platform === 'win32',
      isElectron: Boolean(process.env.ELECTRON_HOST),
      nodeVersion: process.version,
      flashlightSupported: flashlight.supported,
      flashlightReason: flashlight.reason,
      currentTime: dt.formattedTime,
      currentDate: dt.formattedDate,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local',
      apiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
      mapsConfigured: Boolean(
        (process.env.VITE_GOOGLE_MAPS_API_KEY &&
          process.env.VITE_GOOGLE_MAPS_API_KEY !== 'MY_GOOGLE_MAPS_API_KEY') ||
          (process.env.GOOGLE_MAPS_API_KEY &&
            process.env.GOOGLE_MAPS_API_KEY !== 'MY_GOOGLE_MAPS_API_KEY')
      ),
    });
  });

  app.get('/api/maps-config', (_req, res) => {
    const rawVite = process.env.VITE_GOOGLE_MAPS_API_KEY;
    const rawServer = process.env.GOOGLE_MAPS_API_KEY;
    const apiKey =
      rawVite && rawVite !== 'MY_GOOGLE_MAPS_API_KEY'
        ? rawVite
        : rawServer && rawServer !== 'MY_GOOGLE_MAPS_API_KEY'
          ? rawServer
          : '';
    res.json({ apiKey });
  });

  app.get('/api/settings', (_req, res) => {
    res.json(loadSettings());
  });

  app.put('/api/settings', (req, res) => {
    const updated = saveSettings(req.body ?? {});
    res.json(updated);
  });

  app.get('/api/history', (_req, res) => {
    res.json({
      sessions: loadHistory(),
      auditLog: getCommandAuditLog(),
      pendingConfirmations: getPendingConfirmations(),
    });
  });

  app.post('/api/history', (req, res) => {
    const session = req.body as ConversationSession | undefined;
    if (!session || typeof session.id !== 'string' || !Array.isArray(session.messages)) {
      res.status(400).json({ error: 'Invalid conversation session payload.' });
      return;
    }
    const sessions = upsertHistorySession(session);
    res.json({ sessions });
  });

  app.delete('/api/history', (_req, res) => {
    clearHistory();
    res.json({ ok: true });
  });

  app.post('/api/commands/execute', async (req, res) => {
    const { command, args } = (req.body ?? {}) as {
      command?: WindowsCommandName;
      args?: Record<string, unknown>;
    };
    if (!command || typeof command !== 'string') {
      res.status(400).json({ error: 'Command name is required.' });
      return;
    }
    const result = await executeAssistantToolCall(command, args ?? {});
    res.json({ result });
  });

  app.post('/api/commands/confirm', (req, res) => {
    const { confirmationId, decision } = (req.body ?? {}) as {
      confirmationId?: string;
      decision?: 'approved' | 'rejected';
    };
    if (!confirmationId || (decision !== 'approved' && decision !== 'rejected')) {
      res.status(400).json({ error: 'Valid confirmationId and decision ("approved" | "rejected") are required.' });
      return;
    }
    const resolved = resolveSensitiveConfirmation(confirmationId, decision);
    if (!resolved.found) {
      res.status(404).json({ error: 'Confirmation request not found or expired.' });
      return;
    }
    res.json(resolved);
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const {
        message,
        history = [],
        language = 'auto',
        systemPrompt,
      } = (req.body ?? {}) as {
        message?: string;
        history?: Array<{ role: 'user' | 'assistant'; text: string }>;
        language?: LanguagePreference;
        systemPrompt?: string;
      };

      if (!message || typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'Message text is required.' });
        return;
      }

      const ai = getGeminiClient();
      const contents = [
        ...history
          .filter((item) => item && typeof item.text === 'string' && item.text.trim())
          .slice(-16)
          .map((item) => ({
            role: item.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: item.text }],
          })),
        {
          role: 'user',
          parts: [{ text: message.trim() }],
        },
      ];

      const systemInstruction = buildSystemInstruction(systemPrompt, language);

      const generateWithResilience = async (
        payloadContents: Content[]
      ) => {
        try {
          return await withGeminiRetry(() =>
            ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: payloadContents,
              config: {
                systemInstruction,
                tools: [{ functionDeclarations: WINDOWS_TOOL_DECLARATIONS }],
              },
            })
          );
        } catch (primaryErr) {
          const formatted = formatGeminiError(primaryErr);
          if (formatted.status === 503) {
            return await withGeminiRetry(() =>
              ai.models.generateContent({
                model: 'gemini-3.1-flash-lite',
                contents: payloadContents,
                config: {
                  systemInstruction,
                  tools: [{ functionDeclarations: WINDOWS_TOOL_DECLARATIONS }],
                },
              })
            );
          }
          throw primaryErr;
        }
      };

      const firstResponse = await generateWithResilience(contents);

      const commandResults = [];
      const functionCalls = firstResponse.functionCalls ?? [];

      if (functionCalls.length > 0 && firstResponse.candidates?.[0]?.content) {
        const toolResponseParts = [];
        for (const call of functionCalls) {
          if (!call.name) continue;
          const result = await executeAssistantToolCall(
            call.name,
            (call.args as Record<string, unknown> | undefined) ?? {}
          );
          commandResults.push(result);
          toolResponseParts.push({
            functionResponse: {
              id: call.id,
              name: call.name,
              response: {
                status: result.status,
                summary: result.summary,
                details: result.details ?? '',
                launchUrl: result.launchUrl ?? '',
              },
            },
          });
        }

        const followUp = await generateWithResilience([
          ...contents,
          firstResponse.candidates[0].content,
          {
            role: 'user',
            parts: toolResponseParts,
          },
        ]);

        res.json({
          reply: followUp.text ?? commandResults.map((c) => c.summary).join(' '),
          commandResults,
        });
        return;
      }

      res.json({
        reply: firstResponse.text ?? 'I could not generate a response right now.',
        commandResults: [],
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  const httpServer = http.createServer(app);
  attachLiveBridge(httpServer);

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Hey Assistant AI listening on http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Hey Assistant AI server:', err);
  process.exit(1);
});
