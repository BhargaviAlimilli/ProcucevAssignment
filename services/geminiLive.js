import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';

const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';
const DEFAULT_FALLBACK_MODELS = [
  'gemini-3.5-transcribe-live',
  'gemini-3.1-flash-live-preview',
];
const MAX_PENDING_CHUNKS = 100;

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function getModelCandidates() {
  const primary = process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;
  const fallbacksRaw = process.env.GEMINI_LIVE_FALLBACK_MODELS;
  const fallbacks = fallbacksRaw
    ? fallbacksRaw
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean)
    : DEFAULT_FALLBACK_MODELS;

  return [...new Set([primary, ...fallbacks])];
}

/**
 * Attaches the /ws/transcribe WebSocket server to the HTTP server and bridges
 * 16kHz 16-bit mono PCM audio frames to the Gemini Live API.
 */
export function attachTranscribeWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/transcribe' });

  wss.on('connection', (clientWs) => {
    let geminiSession = null;
    let connectPromise = null;
    let clientClosed = false;
    let pendingAudioChunks = [];

    const closeGeminiSession = () => {
      pendingAudioChunks = [];
      if (geminiSession) {
        try {
          geminiSession.close();
        } catch (err) {
          console.warn('[WS/STT] Error closing Gemini session:', err.message);
        }
        geminiSession = null;
      }
    };

    const forwardAudioChunk = (buffer) => {
      if (!geminiSession || clientClosed) return;
      try {
        geminiSession.sendRealtimeInput({
          audio: {
            data: buffer.toString('base64'),
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      } catch (err) {
        console.error('[WS/STT] Failed to send audio chunk:', err.message);
        sendJson(clientWs, {
          type: 'error',
          message: 'Failed to stream audio chunk to Gemini Live API.',
        });
      }
    };

    const ensureGeminiSession = async (languageCodes = []) => {
      if (geminiSession) return geminiSession;
      if (connectPromise) return connectPromise;

      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey) {
        sendJson(clientWs, {
          type: 'error',
          message: 'GEMINI_API_KEY is not configured on the server.',
        });
        return null;
      }

      const candidates = getModelCandidates();
      const ai = new GoogleGenAI({ apiKey });

      connectPromise = (async () => {
        sendJson(clientWs, { type: 'status', status: 'connecting' });

        let lastError = null;
        for (const model of candidates) {
          if (clientClosed) return null;

          try {
            let activeSession = null;
            activeSession = await ai.live.connect({
              model,
              config: {
                responseModalities: [Modality.AUDIO],
                inputAudioTranscription: {
                  languageCodes: Array.isArray(languageCodes) ? languageCodes : [],
                },
                systemInstruction:
                  'You are a silent transcription listener. Do not speak or interrupt; listen accurately to multilingual and code-switched speech.',
              },
              callbacks: {
                onopen: () => {
                  console.log(`[WS/STT] Gemini Live connected (${model})`);
                },
                onmessage: (message) => {
                  if (clientClosed) return;

                  const serverContent = message?.serverContent;
                  const transcription = serverContent?.inputTranscription;

                  if (transcription) {
                    const text = typeof transcription.text === 'string' ? transcription.text : '';
                    const isFinal = Boolean(transcription.finished);

                    if (text.length > 0 || isFinal) {
                      sendJson(clientWs, {
                        type: 'transcript',
                        text,
                        isFinal,
                      });
                    }
                  }

                  if (serverContent?.turnComplete || serverContent?.generationComplete) {
                    sendJson(clientWs, { type: 'turn_complete' });
                  }
                },
                onerror: (err) => {
                  console.error(`[WS/STT] Gemini Live error (${model}):`, err?.message || err);
                  if (!clientClosed) {
                    sendJson(clientWs, {
                      type: 'error',
                      message: err?.message || 'Gemini Live streaming error.',
                    });
                  }
                },
                onclose: (event) => {
                  console.log(
                    `[WS/STT] Gemini Live closed (${model}): code=${event?.code} reason=${event?.reason || 'none'}`
                  );
                  if (geminiSession === activeSession) {
                    geminiSession = null;
                  }
                  if (!clientClosed) {
                    sendJson(clientWs, {
                      type: 'status',
                      status: 'closed',
                      reason: event?.reason || 'Session closed',
                    });
                  }
                },
              },
            });

            if (clientClosed) {
              activeSession.close();
              return null;
            }

            geminiSession = activeSession;
            sendJson(clientWs, {
              type: 'status',
              status: 'ready',
              model,
            });

            if (pendingAudioChunks.length > 0) {
              for (const chunk of pendingAudioChunks) {
                forwardAudioChunk(chunk);
              }
              pendingAudioChunks = [];
            }

            return geminiSession;
          } catch (err) {
            lastError = err;
            console.warn(`[WS/STT] Model "${model}" failed to connect:`, err.message);
          }
        }

        if (!clientClosed) {
          sendJson(clientWs, {
            type: 'error',
            message:
              lastError?.message ||
              'Unable to connect to any configured Gemini Live model.',
          });
        }
        return null;
      })();

      try {
        return await connectPromise;
      } finally {
        connectPromise = null;
      }
    };

    clientWs.on('message', async (data, isBinary) => {
      if (!isBinary) {
        try {
          const control = JSON.parse(data.toString('utf8'));
          if (control?.type === 'start') {
            await ensureGeminiSession(control.languageCodes || []);
          } else if (control?.type === 'stop') {
            if (geminiSession) {
              try {
                geminiSession.sendRealtimeInput({ audioStreamEnd: true });
              } catch {
                // Ignore if already closing
              }
            }
            closeGeminiSession();
            sendJson(clientWs, { type: 'status', status: 'stopped' });
          }
        } catch {
          sendJson(clientWs, { type: 'error', message: 'Invalid JSON control frame.' });
        }
        return;
      }

      const pcmBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (pcmBuffer.length === 0) return;

      if (geminiSession) {
        forwardAudioChunk(pcmBuffer);
      } else {
        if (pendingAudioChunks.length >= MAX_PENDING_CHUNKS) {
          pendingAudioChunks.shift();
        }
        pendingAudioChunks.push(pcmBuffer);
        if (!connectPromise) {
          void ensureGeminiSession([]);
        }
      }
    });

    clientWs.on('close', () => {
      clientClosed = true;
      closeGeminiSession();
    });

    clientWs.on('error', (err) => {
      console.error('[WS/STT] Client WebSocket error:', err.message);
      clientClosed = true;
      closeGeminiSession();
    });
  });

  return wss;
}
