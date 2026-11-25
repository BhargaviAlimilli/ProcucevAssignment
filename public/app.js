// --- State ---
const state = {
  isRecording: false,
  isEditingStudio: false,
  committedText: '',
  interimText: '',
  elapsedSeconds: 0,
  timerInterval: null,
  ws: null,
  audioContext: null,
  mediaStream: null,
  sourceNode: null,
  workletNode: null,
  scriptNode: null,
  activeTtsId: null,
  searchTimer: null,
  transcriptions: [],
};

// --- DOM Elements ---
const dbStatusBadge = document.getElementById('dbStatusBadge');
const geminiStatusBadge = document.getElementById('geminiStatusBadge');
const wsStatusPill = document.getElementById('wsStatusPill');

const sessionTitleInput = document.getElementById('sessionTitle');
const languageModeSelect = document.getElementById('languageMode');
const recordBtn = document.getElementById('recordBtn');
const recordDot = document.getElementById('recordDot');
const recordBtnLabel = document.getElementById('recordBtnLabel');
const recordingTimer = document.getElementById('recordingTimer');
const micLevelBar = document.getElementById('micLevelBar');
const micLevelPercent = document.getElementById('micLevelPercent');

const liveTranscriptDisplay = document.getElementById('liveTranscriptDisplay');
const emptyTranscriptPlaceholder = document.getElementById('emptyTranscriptPlaceholder');
const committedTextSpan = document.getElementById('committedTextSpan');
const interimTextSpan = document.getElementById('interimTextSpan');
const liveCursor = document.getElementById('liveCursor');
const toggleEditStudioBtn = document.getElementById('toggleEditStudioBtn');
const studioEditTextarea = document.getElementById('studioEditTextarea');

const clearStudioBtn = document.getElementById('clearStudioBtn');
const saveTranscriptBtn = document.getElementById('saveTranscriptBtn');

const historyCountBadge = document.getElementById('historyCountBadge');
const historyList = document.getElementById('historyList');
const searchInput = document.getElementById('searchInput');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
const ttsLangSelect = document.getElementById('ttsLangSelect');
const stopTtsGlobalBtn = document.getElementById('stopTtsGlobalBtn');

const editModal = document.getElementById('editModal');
const closeEditModalBtn = document.getElementById('closeEditModalBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const editForm = document.getElementById('editForm');
const editIdInput = document.getElementById('editId');
const editTitleInput = document.getElementById('editTitle');
const editContentInput = document.getElementById('editContent');
const toastContainer = document.getElementById('toastContainer');

// --- Utilities ---
function showToast(message, type = 'info') {
  const palette = {
    info: 'bg-slate-900 text-white',
    success: 'bg-emerald-600 text-white',
    error: 'bg-rose-600 text-white',
  };
  const toast = document.createElement('div');
  toast.className = `pointer-events-auto px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium transition-opacity duration-300 ${palette[type] || palette.info}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function formatDuration(totalSeconds) {
  const secs = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getSelectedLanguageCodes() {
  const mode = languageModeSelect.value;
  if (mode.includes('hi-IN, en-IN')) return ['hi-IN', 'en-IN'];
  if (mode.includes('hi-IN')) return ['hi-IN'];
  if (mode.includes('en-IN')) return ['en-IN'];
  if (mode.includes('en-US')) return ['en-US'];
  return []; // Empty array enables automatic multilingual & code-switching detection
}

function appendSmartText(existing, addition) {
  if (!addition) return existing;
  if (!existing) return addition.trimStart();
  const needsSpace =
    !/\s$/.test(existing) && !/^[\s.,!?;:।]/.test(addition);
  return needsSpace ? `${existing} ${addition}` : `${existing}${addition}`;
}

function renderTranscriptDisplay() {
  const hasAnyText = Boolean(state.committedText || state.interimText);
  emptyTranscriptPlaceholder.classList.toggle('hidden', hasAnyText);
  committedTextSpan.textContent = state.committedText;
  interimTextSpan.textContent =
    state.committedText && state.interimText && !/\s$/.test(state.committedText) && !/^\s/.test(state.interimText)
      ? ` ${state.interimText}`
      : state.interimText;
  liveCursor.classList.toggle('hidden', !state.isRecording);
  liveTranscriptDisplay.scrollTop = liveTranscriptDisplay.scrollHeight;

  if (state.isEditingStudio) {
    studioEditTextarea.value = getFullStudioText();
  }
}

function getFullStudioText() {
  if (state.isEditingStudio) {
    return studioEditTextarea.value.trim();
  }
  return appendSmartText(state.committedText, state.interimText).trim();
}

function setWsStatus(text, tone = 'neutral') {
  const tones = {
    neutral: 'bg-slate-100 text-slate-600',
    connecting: 'bg-amber-100 text-amber-800',
    live: 'bg-emerald-100 text-emerald-800',
    error: 'bg-rose-100 text-rose-800',
  };
  wsStatusPill.className = `px-2.5 py-1 rounded-full text-xs font-medium shrink-0 ${tones[tone] || tones.neutral}`;
  wsStatusPill.textContent = text;
}

// --- Health Check ---
async function checkServerHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();

    if (data.db === 'connected') {
      dbStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700';
      dbStatusBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500"></span>DB: Connected';
    } else {
      dbStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700';
      dbStatusBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500"></span>DB: Not Configured';
    }

    if (data.geminiConfigured) {
      geminiStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700';
      geminiStatusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-indigo-500"></span>${escapeHtml(data.model || 'Gemini Live')}`;
    } else {
      geminiStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700';
      geminiStatusBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-500"></span>Gemini Key Missing';
    }
  } catch {
    dbStatusBadge.textContent = 'Server Offline';
  }
}

// --- Audio Resampling & 16kHz Int16 PCM Encoding ---
function downsampleTo16kPcm(inputBuffer, inputSampleRate) {
  const targetRate = 16000;
  let samples = inputBuffer;

  if (inputSampleRate !== targetRate) {
    const ratio = inputSampleRate / targetRate;
    const outputLength = Math.max(1, Math.round(inputBuffer.length / ratio));
    samples = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const low = Math.floor(srcIndex);
      const high = Math.min(low + 1, inputBuffer.length - 1);
      const frac = srcIndex - low;
      samples[i] = inputBuffer[low] * (1 - frac) + inputBuffer[high] * frac;
    }
  }

  const pcmBuffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(pcmBuffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return pcmBuffer;
}

function updateMicMeter(float32Samples) {
  let sumSq = 0;
  for (let i = 0; i < float32Samples.length; i++) {
    sumSq += float32Samples[i] * float32Samples[i];
  }
  const rms = Math.sqrt(sumSq / Math.max(1, float32Samples.length));
  const percent = Math.min(100, Math.round(rms * 350));
  micLevelBar.style.width = `${percent}%`;
  micLevelPercent.textContent = `${percent}%`;
}

// --- Live Recording & WebSocket Streaming ---
async function startRecording() {
  if (state.isRecording) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Microphone capture is not supported in this browser.', 'error');
    return;
  }

  if (state.isEditingStudio) {
    state.committedText = studioEditTextarea.value;
    state.interimText = '';
    state.isEditingStudio = false;
    studioEditTextarea.classList.add('hidden');
    liveTranscriptDisplay.classList.remove('hidden');
    toggleEditStudioBtn.textContent = 'Edit Text';
    renderTranscriptDisplay();
  }

  try {
    setWsStatus('Connecting...', 'connecting');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    state.mediaStream = stream;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/transcribe`);
    ws.binaryType = 'arraybuffer';
    state.ws = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'start',
          languageCodes: getSelectedLanguageCodes(),
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'status') {
          if (msg.status === 'ready') {
            setWsStatus(`Live (${msg.model})`, 'live');
          } else if (msg.status === 'connecting') {
            setWsStatus('Connecting Gemini...', 'connecting');
          } else if (msg.status === 'stopped' || msg.status === 'closed') {
            if (!state.isRecording) setWsStatus('Idle', 'neutral');
          }
        } else if (msg.type === 'transcript') {
          const chunk = msg.text || '';
          if (msg.isFinal) {
            if (chunk) {
              if (state.interimText && chunk.startsWith(state.interimText)) {
                state.committedText = appendSmartText(state.committedText, chunk);
              } else {
                const combined = appendSmartText(state.interimText, chunk);
                state.committedText = appendSmartText(state.committedText, combined);
              }
            } else if (state.interimText) {
              state.committedText = appendSmartText(state.committedText, state.interimText);
            }
            state.interimText = '';
          } else if (chunk) {
            state.interimText = appendSmartText(state.interimText, chunk);
          }
          renderTranscriptDisplay();
        } else if (msg.type === 'turn_complete') {
          if (state.interimText) {
            state.committedText = appendSmartText(state.committedText, state.interimText);
            state.interimText = '';
            renderTranscriptDisplay();
          }
        } else if (msg.type === 'error') {
          setWsStatus('Error', 'error');
          showToast(msg.message || 'Transcription error occurred.', 'error');
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onerror = () => {
      setWsStatus('WS Error', 'error');
      showToast('WebSocket connection error.', 'error');
    };

    ws.onclose = () => {
      if (state.isRecording) {
        stopRecording({ skipWsClose: true });
      } else {
        setWsStatus('Idle', 'neutral');
      }
    };

    // AudioContext + AudioWorklet (with ScriptProcessor fallback)
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioCtx({ sampleRate: 16000 });
    state.audioContext = audioContext;
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const sourceNode = audioContext.createMediaStreamSource(stream);
    state.sourceNode = sourceNode;

    const handlePcmFrame = (float32Chunk) => {
      updateMicMeter(float32Chunk);
      if (ws.readyState === WebSocket.OPEN) {
        const pcmBytes = downsampleTo16kPcm(float32Chunk, audioContext.sampleRate);
        ws.send(pcmBytes);
      }
    };

    if (audioContext.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      const workletCode = `
        class PcmCaptureProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this._buffer = new Float32Array(2048);
            this._offset = 0;
          }
          process(inputs) {
            const input = inputs[0];
            if (!input || !input[0]) return true;
            const channel = input[0];
            for (let i = 0; i < channel.length; i++) {
              this._buffer[this._offset++] = channel[i];
              if (this._offset >= this._buffer.length) {
                this.port.postMessage(this._buffer.slice(0));
                this._offset = 0;
              }
            }
            return true;
          }
        }
        registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
      `;
      const blobUrl = URL.createObjectURL(
        new Blob([workletCode], { type: 'application/javascript' })
      );
      await audioContext.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);

      const workletNode = new AudioWorkletNode(audioContext, 'pcm-capture-processor');
      workletNode.port.onmessage = (e) => handlePcmFrame(e.data);
      sourceNode.connect(workletNode);
      workletNode.connect(audioContext.destination);
      state.workletNode = workletNode;
    } else {
      const scriptNode = audioContext.createScriptProcessor(4096, 1, 1);
      scriptNode.onaudioprocess = (e) => {
        handlePcmFrame(e.inputBuffer.getChannelData(0));
      };
      sourceNode.connect(scriptNode);
      scriptNode.connect(audioContext.destination);
      state.scriptNode = scriptNode;
    }

    state.isRecording = true;
    state.timerInterval = setInterval(() => {
      state.elapsedSeconds += 1;
      recordingTimer.textContent = formatDuration(state.elapsedSeconds);
    }, 1000);

    recordBtn.className =
      'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 recording-active transition shadow-sm';
    recordBtnLabel.textContent = 'Stop Microphone';
    recordDot.className = 'w-2.5 h-2.5 rounded-sm bg-white';
    renderTranscriptDisplay();
  } catch (err) {
    console.error('Could not start microphone:', err);
    showToast(err.message || 'Microphone access denied.', 'error');
    stopRecording();
  }
}

function stopRecording({ skipWsClose = false } = {}) {
  state.isRecording = false;

  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  if (state.interimText) {
    state.committedText = appendSmartText(state.committedText, state.interimText);
    state.interimText = '';
  }

  if (state.workletNode) {
    state.workletNode.disconnect();
    state.workletNode = null;
  }
  if (state.scriptNode) {
    state.scriptNode.disconnect();
    state.scriptNode = null;
  }
  if (state.sourceNode) {
    state.sourceNode.disconnect();
    state.sourceNode = null;
  }
  if (state.audioContext) {
    state.audioContext.close().catch(() => {});
    state.audioContext = null;
  }
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach((track) => track.stop());
    state.mediaStream = null;
  }

  if (!skipWsClose && state.ws) {
    if (state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'stop' }));
      state.ws.close();
    }
    state.ws = null;
  }

  micLevelBar.style.width = '0%';
  micLevelPercent.textContent = '0%';

  recordBtn.className =
    'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] transition shadow-sm';
  recordBtnLabel.textContent = 'Start Microphone';
  recordDot.className = 'w-2.5 h-2.5 rounded-full bg-white';
  setWsStatus('Idle', 'neutral');
  renderTranscriptDisplay();
}

// --- Studio Actions ---
recordBtn.addEventListener('click', () => {
  if (state.isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

toggleEditStudioBtn.addEventListener('click', () => {
  if (state.isRecording) {
    showToast('Stop recording before manually editing text.', 'info');
    return;
  }

  if (!state.isEditingStudio) {
    state.isEditingStudio = true;
    studioEditTextarea.value = getFullStudioText();
    liveTranscriptDisplay.classList.add('hidden');
    studioEditTextarea.classList.remove('hidden');
    studioEditTextarea.focus();
    toggleEditStudioBtn.textContent = 'Done Editing';
  } else {
    state.committedText = studioEditTextarea.value.trim();
    state.interimText = '';
    state.isEditingStudio = false;
    studioEditTextarea.classList.add('hidden');
    liveTranscriptDisplay.classList.remove('hidden');
    toggleEditStudioBtn.textContent = 'Edit Text';
    renderTranscriptDisplay();
  }
});

clearStudioBtn.addEventListener('click', () => {
  if (state.isRecording) {
    stopRecording();
  }
  state.committedText = '';
  state.interimText = '';
  state.elapsedSeconds = 0;
  recordingTimer.textContent = '00:00';
  sessionTitleInput.value = '';
  studioEditTextarea.value = '';
  renderTranscriptDisplay();
});

saveTranscriptBtn.addEventListener('click', async () => {
  const content = getFullStudioText();
  if (!content) {
    showToast('Record or enter a transcript before saving.', 'error');
    return;
  }

  const title = sessionTitleInput.value.trim() || 'Untitled Transcript';
  const language_mode = languageModeSelect.value;
  const duration_seconds = state.elapsedSeconds;

  saveTranscriptBtn.disabled = true;
  try {
    const res = await fetch('/api/transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, language_mode, duration_seconds }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save transcript.');
    }

    showToast('Transcription saved to PostgreSQL!', 'success');
    sessionTitleInput.value = '';
    state.committedText = '';
    state.interimText = '';
    state.elapsedSeconds = 0;
    recordingTimer.textContent = '00:00';
    studioEditTextarea.value = '';
    if (state.isEditingStudio) {
      state.isEditingStudio = false;
      studioEditTextarea.classList.add('hidden');
      liveTranscriptDisplay.classList.remove('hidden');
      toggleEditStudioBtn.textContent = 'Edit Text';
    }
    renderTranscriptDisplay();
    await fetchTranscriptions(searchInput.value.trim());
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    saveTranscriptBtn.disabled = false;
  }
});

// --- Text-to-Speech (Browser Native Web Speech API) ---
function stopSpeech() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  state.activeTtsId = null;
  stopTtsGlobalBtn.classList.add('hidden');
  renderHistoryList();
}

function speakTranscript(item) {
  if (!('speechSynthesis' in window)) {
    showToast('Web Speech API TTS is not supported in this browser.', 'error');
    return;
  }

  if (state.activeTtsId === item.id) {
    stopSpeech();
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(item.content);
  const selectedLang = ttsLangSelect.value || 'en-IN';
  utterance.lang = selectedLang;

  const voices = window.speechSynthesis.getVoices();
  const matchingVoice =
    voices.find((v) => v.lang.toLowerCase() === selectedLang.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(selectedLang.split('-')[0]));
  if (matchingVoice) {
    utterance.voice = matchingVoice;
  }

  utterance.onend = () => {
    state.activeTtsId = null;
    stopTtsGlobalBtn.classList.add('hidden');
    renderHistoryList();
  };

  utterance.onerror = () => {
    state.activeTtsId = null;
    stopTtsGlobalBtn.classList.add('hidden');
    renderHistoryList();
  };

  state.activeTtsId = item.id;
  stopTtsGlobalBtn.classList.remove('hidden');
  renderHistoryList();
  window.speechSynthesis.speak(utterance);
}

stopTtsGlobalBtn.addEventListener('click', stopSpeech);

// Ensure voices populate asynchronously in Chrome
if ('speechSynthesis' in window && typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

// --- CRUD History Dashboard ---
async function fetchTranscriptions(search = '') {
  try {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    const res = await fetch(`/api/transcriptions${query}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to load history.');
    }

    state.transcriptions = data.transcriptions || [];
    historyCountBadge.textContent = String(state.transcriptions.length);
    renderHistoryList();
  } catch (err) {
    historyList.innerHTML = `
      <div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        ${escapeHtml(err.message)}
      </div>
    `;
  }
}

function renderHistoryList() {
  if (!state.transcriptions.length) {
    historyList.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-200 py-12 px-4 text-center text-sm text-slate-400">
        No saved transcriptions found. Record audio on the left and click "Save to Database".
      </div>
    `;
    return;
  }

  historyList.innerHTML = state.transcriptions
    .map((item) => {
      const isPlaying = state.activeTtsId === item.id;
      return `
        <article class="rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-white transition p-4 space-y-3" data-id="${item.id}">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="space-y-1">
              <h3 class="text-sm font-semibold text-slate-900">${escapeHtml(item.title)}</h3>
              <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span class="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-medium">${escapeHtml(item.language_mode || 'Auto')}</span>
                <span>${formatDate(item.created_at)}</span>
                <span>&bull;</span>
                <span class="font-mono">${formatDuration(item.duration_seconds)}</span>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-action="tts"
                data-id="${item.id}"
                class="px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                  isPlaying
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                }"
              >
                ${isPlaying ? 'Stop' : 'Listen'}
              </button>
              <button
                type="button"
                data-action="copy"
                data-id="${item.id}"
                class="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition"
              >
                Copy
              </button>
              <button
                type="button"
                data-action="edit"
                data-id="${item.id}"
                class="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition"
              >
                Edit
              </button>
              <button
                type="button"
                data-action="delete"
                data-id="${item.id}"
                class="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 transition"
              >
                Delete
              </button>
            </div>
          </div>

          <p class="transcript-font text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">${escapeHtml(item.content)}</p>
        </article>
      `;
    })
    .join('');
}

historyList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const id = Number(btn.dataset.id);
  const action = btn.dataset.action;
  const item = state.transcriptions.find((t) => t.id === id);
  if (!item) return;

  if (action === 'tts') {
    speakTranscript(item);
  } else if (action === 'copy') {
    try {
      await navigator.clipboard.writeText(item.content);
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 1500);
      showToast('Copied transcript to clipboard.', 'success');
    } catch {
      showToast('Clipboard permission denied.', 'error');
    }
  } else if (action === 'edit') {
    editIdInput.value = String(item.id);
    editTitleInput.value = item.title;
    editContentInput.value = item.content;
    editModal.classList.remove('hidden');
  } else if (action === 'delete') {
    if (!window.confirm(`Delete "${item.title}"? This action cannot be undone.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/transcriptions/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete transcript.');
      if (state.activeTtsId === id) stopSpeech();
      showToast('Transcription deleted.', 'success');
      await fetchTranscriptions(searchInput.value.trim());
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
});

// --- Edit Modal ---
function closeEditModal() {
  editModal.classList.add('hidden');
}

closeEditModalBtn.addEventListener('click', closeEditModal);
cancelEditBtn.addEventListener('click', closeEditModal);

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = Number(editIdInput.value);
  const title = editTitleInput.value.trim();
  const content = editContentInput.value.trim();

  if (!title || !content) {
    showToast('Title and content cannot be empty.', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/transcriptions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update transcript.');

    closeEditModal();
    showToast('Transcription updated!', 'success');
    await fetchTranscriptions(searchInput.value.trim());
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// --- Search & Refresh ---
searchInput.addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    fetchTranscriptions(searchInput.value.trim());
  }, 250);
});

refreshHistoryBtn.addEventListener('click', () => {
  fetchTranscriptions(searchInput.value.trim());
});

// --- Init ---
checkServerHealth();
fetchTranscriptions();
