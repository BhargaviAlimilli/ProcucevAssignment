export const PCM_WORKLET_CODE = `
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

export function downsampleTo16kPcm(inputBuffer, inputSampleRate) {
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

export function calculateLevelPercent(float32Samples) {
  let sumSq = 0;
  for (let i = 0; i < float32Samples.length; i++) {
    sumSq += float32Samples[i] * float32Samples[i];
  }
  const rms = Math.sqrt(sumSq / Math.max(1, float32Samples.length));
  return Math.min(100, Math.round(rms * 360));
}

export function computeSpectrumBars(analyser, barCount = 24) {
  if (!analyser) return new Array(barCount).fill(6);
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(freqData);
  const step = Math.max(1, Math.floor(freqData.length / barCount));
  const bars = [];
  for (let i = 0; i < barCount; i++) {
    let sum = 0;
    const start = i * step;
    for (let j = 0; j < step; j++) {
      sum += freqData[start + j] || 0;
    }
    const avg = sum / step;
    bars.push(Math.max(8, Math.min(100, Math.round((avg / 255) * 100))));
  }
  return bars;
}

export function formatDuration(totalSeconds) {
  const secs = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export function appendSmartText(existing, addition) {
  if (!addition) return existing;
  if (!existing) return addition.trimStart();
  const needsSpace = !/\s$/.test(existing) && !/^[\s.,!?;:।]/.test(addition);
  return needsSpace ? `${existing} ${addition}` : `${existing}${addition}`;
}

/**
 * Inspects Unicode script ranges to identify Hindi (Devanagari), English (Latin),
 * or Bilingual Code-Switched transcripts.
 */
export function detectScriptBadge(text) {
  if (!text || !text.trim()) return null;
  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);

  if (hasDevanagari && hasLatin) {
    return { label: 'BILINGUAL · HI + EN', tone: 'bilingual' };
  }
  if (hasDevanagari) {
    return { label: 'DEVANAGARI · HI', tone: 'hindi' };
  }
  if (hasLatin) {
    return { label: 'LATIN · EN', tone: 'english' };
  }
  return { label: 'MULTILINGUAL', tone: 'neutral' };
}
