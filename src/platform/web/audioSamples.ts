/** Average-downsample interleaved channel samples to 16 kHz mono for Whisper-tiny. */
export function downsampleTo16k(input: Float32Array, sampleRate: number): Float32Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('Audio sample rate is missing.');
  }
  if (sampleRate === 16000) return input;
  const ratio = sampleRate / 16000;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      sum += input[cursor] ?? 0;
      count += 1;
    }
    output[index] = count > 0 ? sum / count : 0;
  }
  return output;
}

export async function samplesFromMediaFile(file: Blob): Promise<Float32Array> {
  const Context = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) {
    throw new Error('This browser cannot decode audio (AudioContext is missing).');
  }
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const channel = decoded.getChannelData(0);
    return downsampleTo16k(channel, decoded.sampleRate);
  } finally {
    await context.close().catch(() => undefined);
  }
}
