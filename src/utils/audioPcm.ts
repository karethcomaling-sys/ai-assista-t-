export function float32ToInt16Base64(float32Data: Float32Array): string {
  const int16 = new Int16Array(float32Data.length);
  for (let i = 0; i < float32Data.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32Data[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64Pcm24kToAudioBuffer(
  audioCtx: AudioContext,
  base64Data: string
): AudioBuffer {
  const binary = atob(base64Data);
  const byteLength = binary.length;
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const sampleCount = Math.floor(byteLength / 2);
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const buffer = audioCtx.createBuffer(1, sampleCount, 24000);
  const channel = buffer.getChannelData(0);

  for (let i = 0; i < sampleCount; i++) {
    const int16Sample = dataView.getInt16(i * 2, true);
    channel[i] = int16Sample / 32768;
  }
  return buffer;
}

export function computeRmsLevel(float32Data: Float32Array): number {
  if (float32Data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < float32Data.length; i++) {
    sum += float32Data[i] * float32Data[i];
  }
  const rms = Math.sqrt(sum / float32Data.length);
  return Math.min(1, rms * 4.5);
}
