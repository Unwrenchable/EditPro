import { toBlobURL } from '@ffmpeg/util';
import { abortError } from './abort';

export interface FfmpegSession {
  load(options?: { coreURL?: string; wasmURL?: string }): Promise<boolean>;
  writeFile(path: string, data: Uint8Array): Promise<unknown>;
  readFile(path: string): Promise<Uint8Array | string>;
  exec(args: string[], timeout?: number, options?: { signal?: AbortSignal }): Promise<number>;
  terminate(): void;
  on(event: 'progress', listener: (event: { progress: number; time?: number }) => void): void;
}

export interface FfmpegModule {
  FFmpeg: new () => FfmpegSession;
}

const LOCAL_CORE = '/ffmpeg';
const CDN_CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

let session: FfmpegSession | null = null;
let loadPromise: Promise<FfmpegSession> | null = null;

export async function loadFfmpegModule(): Promise<FfmpegModule> {
  return (await import('@ffmpeg/ffmpeg')) as unknown as FfmpegModule;
}

async function coreUrls(base: string): Promise<{ coreURL: string; wasmURL: string }> {
  const [coreURL, wasmURL] = await Promise.all([
    toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  ]);
  return { coreURL, wasmURL };
}

export async function loadFfmpegSession(): Promise<FfmpegSession> {
  if (session) return session;
  if (!loadPromise) {
    loadPromise = (async () => {
      const { FFmpeg } = await loadFfmpegModule();
      const ffmpeg = new FFmpeg();
      try {
        const local = await ffmpeg.load(await coreUrls(LOCAL_CORE));
        if (!local) throw new Error('Local ffmpeg.wasm core did not load.');
      } catch {
        const remote = await ffmpeg.load(await coreUrls(CDN_CORE));
        if (!remote) throw new Error('ffmpeg.wasm core did not load from jsDelivr.');
      }
      session = ffmpeg;
      return ffmpeg;
    })().catch((error) => {
      loadPromise = null;
      session = null;
      throw error;
    });
  }
  return loadPromise;
}

/** Test hook. Production code keeps one loaded core. */
export function resetFfmpegSession(): void {
  session?.terminate();
  session = null;
  loadPromise = null;
}

export async function exportWithFfmpegWasm(options: {
  source: Blob;
  args: string[];
  outputName: string;
  signal: AbortSignal;
  onProgress: (percent: number, timeSec?: number) => void;
}): Promise<Uint8Array> {
  if (options.signal.aborted) throw abortError();
  const ffmpeg = await loadFfmpegSession();
  const onProgress = ({ progress, time }: { progress: number; time?: number }) => {
    const percent = Math.max(0, Math.min(100, Math.round((progress || 0) * 100)));
    const timeSec = typeof time === 'number' ? time / 1_000_000 : undefined;
    options.onProgress(percent, timeSec);
  };
  ffmpeg.on('progress', onProgress);
  const onAbort = () => {
    ffmpeg.terminate();
    session = null;
    loadPromise = null;
  };
  options.signal.addEventListener('abort', onAbort, { once: true });
  try {
    const bytes = new Uint8Array(await options.source.arrayBuffer());
    await ffmpeg.writeFile('input', bytes);
    const code = await ffmpeg.exec(options.args, undefined, { signal: options.signal });
    if (options.signal.aborted) throw abortError();
    if (code !== 0) {
      throw new Error(`ffmpeg.wasm exited with code ${code}. The desktop app's ffmpeg can encode this edit.`);
    }
    const data = await ffmpeg.readFile(options.outputName);
    if (typeof data === 'string') {
      throw new Error('ffmpeg.wasm returned text instead of a video file.');
    }
    options.onProgress(100);
    return data;
  } catch (error) {
    if (options.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw abortError();
    const reason = error instanceof Error ? error.message : 'ffmpeg.wasm failed to load.';
    throw new Error(
      `ffmpeg.wasm is unavailable (${reason}). Place ffmpeg-core.js and ffmpeg-core.wasm in /ffmpeg (npm run fetch:ffmpeg) or allow the jsDelivr copy. The desktop app bundles ffmpeg and does not need this step.`,
    );
  } finally {
    options.signal.removeEventListener('abort', onAbort);
  }
}
