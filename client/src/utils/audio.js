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
  return Math.min(100, Math.round(rms * 350));
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
