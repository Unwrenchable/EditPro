import type { TranscriptionResult } from '../types';

interface AsrPipeline {
  (audio: Float32Array, options?: { sampling_rate?: number }): Promise<{ text?: string } | string>;
}

interface TransformersModule {
  pipeline: (
    task: 'automatic-speech-recognition',
    model: string,
    options?: { device?: 'wasm' | 'webgpu' },
  ) => Promise<AsrPipeline>;
}

const MODEL = 'Xenova/whisper-tiny';
let cached: Promise<AsrPipeline> | null = null;

export async function loadTransformers(): Promise<TransformersModule> {
  return (await import('@huggingface/transformers')) as unknown as TransformersModule;
}

async function asrPipeline(): Promise<AsrPipeline> {
  if (!cached) {
    cached = (async () => {
      const mod = await loadTransformers();
      return mod.pipeline('automatic-speech-recognition', MODEL, { device: 'wasm' });
    })().catch((error) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}

export function resetTranscriber(): void {
  cached = null;
}

/**
 * On-device Whisper-tiny via transformers.js.
 * The weights download once into the browser cache. Callers surface failures
 * without pretending a desktop Whisper binary ran.
 */
export async function transcribeWithTransformers(samples: Float32Array, sampleRate: number): Promise<TranscriptionResult> {
  try {
    const transcriber = await asrPipeline();
    const output = await transcriber(samples, { sampling_rate: sampleRate });
    const text = typeof output === 'string' ? output : output.text ?? '';
    const trimmed = text.trim();
    if (!trimmed) {
      return {
        status: 'error',
        text: '',
        engine: 'transformers-js',
        message: 'transformers.js ran Whisper-tiny on this device and did not return any words. The desktop app does not bundle Whisper either, so nothing was uploaded.',
      };
    }
    return {
      status: 'done',
      text: trimmed,
      engine: 'transformers-js',
      message: 'Transcribed on this device with transformers.js (Whisper-tiny). Audio was not uploaded.',
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The speech model did not load.';
    return {
      status: 'error',
      text: '',
      engine: 'transformers-js',
      message: `transformers.js could not transcribe this clip (${reason}). Desktop EditPro does not bundle a Whisper binary in this build. Audio was not uploaded.`,
    };
  }
}
