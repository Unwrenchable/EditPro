/**
 * Spawn the bundled ffmpeg and keep its log. Cancel aborts the child.
 * Argument vectors only — no shell.
 */
import { spawn } from 'node:child_process';

export interface FfmpegRun {
  code: number;
  text: string;
  cancelled: boolean;
}

export function runProcess(
  file: string,
  args: string[],
  options?: {
    signal?: AbortSignal;
    onText?: (chunk: string) => void;
    env?: NodeJS.ProcessEnv;
  },
): Promise<FfmpegRun> {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      resolve({ code: -1, text: '', cancelled: true });
      return;
    }
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options?.env,
    });
    let text = '';
    const push = (chunk: Buffer) => {
      const piece = chunk.toString('utf8');
      text += piece;
      if (text.length > 8_000_000) text = text.slice(-6_000_000);
      options?.onText?.(piece);
    };
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    const stop = () => {
      if (child.exitCode != null || child.signalCode != null) return;
      child.kill('SIGTERM');
    };
    options?.signal?.addEventListener('abort', stop, { once: true });
    child.on('error', (error) => {
      options?.signal?.removeEventListener('abort', stop);
      reject(error);
    });
    child.on('close', (code) => {
      options?.signal?.removeEventListener('abort', stop);
      resolve({
        code: code ?? -1,
        text,
        cancelled: options?.signal?.aborted === true,
      });
    });
  });
}

export function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  options?: {
    signal?: AbortSignal;
    onText?: (chunk: string) => void;
    env?: NodeJS.ProcessEnv;
  },
): Promise<FfmpegRun> {
  return runProcess(ffmpegPath, args, options);
}

export function extractWavArgs(input: string, output: string): string[] {
  return ['-y', '-hide_banner', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output];
}
