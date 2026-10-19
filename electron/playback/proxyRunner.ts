/**
 * Background proxy encode. One ffmpeg process per job.
 * Hardware decode is attempted first (`-hwaccel auto`) and retried in software
 * when the machine has no usable decoder. Audio is optional.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import { createProgressParser, explainSpawnError, ffmpegStopAction, type ProgressUpdate } from '../export/plan.js';
import { buildProxyArgs, explainProxyFailure, nextProxyAttempt } from './proxyPlan.js';

interface ActiveProxy {
  child: ChildProcess | null;
  cancelled: boolean;
  partialPath: string;
}

const jobs = new Map<string, ActiveProxy>();
const pendingCancel = new Set<string>();

export function cancelProxyJob(jobId: string): void {
  pendingCancel.add(jobId);
  const job = jobs.get(jobId);
  if (!job || job.cancelled) return;
  job.cancelled = true;
  if (job.child) stopProcess(job.child);
}

export function cancelAllProxyJobs(): void {
  for (const jobId of jobs.keys()) cancelProxyJob(jobId);
}

export function isProxyJobCancelled(jobId: string): boolean {
  return pendingCancel.has(jobId) || jobs.get(jobId)?.cancelled === true;
}

/** Drop a cancel token once the job is gone so the set does not grow forever. */
export function acknowledgeProxyCancel(jobId: string): void {
  if (!jobs.has(jobId)) pendingCancel.delete(jobId);
}

function stopProcess(child: ChildProcess): void {
  if (!child.pid) {
    child.kill();
    return;
  }
  const action = ffmpegStopAction(child.pid, process.platform);
  if (action.kind === 'signal') {
    child.kill(action.signal);
    return;
  }
  const killer = spawn(action.file, action.args, { windowsHide: true, stdio: 'ignore' });
  killer.on('error', () => {
    child.kill();
  });
}

async function removePartial(partialPath: string): Promise<void> {
  try {
    await fs.unlink(partialPath);
  } catch {
    // The encode may not have created a file yet.
  }
}

interface SpawnResult {
  code: number | null;
  stderr: string;
  cancelled: boolean;
  spawnError: NodeJS.ErrnoException | null;
}

function spawnOnce(
  jobId: string,
  ffmpegPath: string,
  args: string[],
  partialPath: string,
  durationSec: number,
  onProgress: (update: ProgressUpdate) => void,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    if (pendingCancel.has(jobId)) {
      resolve({ code: null, stderr: '', cancelled: true, spawnError: null });
      return;
    }
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const record = jobs.get(jobId);
    if (record) record.child = child;
    const parser = createProgressParser();
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const update of parser.push(chunk.toString('utf8'), durationSec)) {
        onProgress(update);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 20000) stderr = stderr.slice(-14000);
    });

    const finish = (result: SpawnResult) => {
      if (record) record.child = null;
      resolve(result);
    };

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ code: null, stderr: error.message ?? '', cancelled: false, spawnError: error });
    });
    child.on('close', (code) => {
      const cancelled = record?.cancelled === true || pendingCancel.has(jobId);
      finish({ code, stderr, cancelled, spawnError: null });
    });
  });
}

export interface ProxyEncodeResult {
  status: 'done' | 'cancelled' | 'error';
  message?: string;
}

export async function runProxyEncode(options: {
  jobId: string;
  ffmpegPath: string;
  inputPath: string;
  partialPath: string;
  finalPath: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  onProgress: (update: ProgressUpdate) => void;
}): Promise<ProxyEncodeResult> {
  const record: ActiveProxy = { child: null, cancelled: pendingCancel.has(options.jobId), partialPath: options.partialPath };
  jobs.set(options.jobId, record);

  let hwaccel = true;
  let includeAudio = true;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (record.cancelled || pendingCancel.has(options.jobId)) {
        await removePartial(options.partialPath);
        return { status: 'cancelled' };
      }
      await removePartial(options.partialPath);
      const args = buildProxyArgs({
        inputPath: options.inputPath,
        outputPath: options.partialPath,
        width: options.width,
        height: options.height,
        fps: options.fps,
        hwaccel,
        includeAudio,
      });
      const result = await spawnOnce(
        options.jobId,
        options.ffmpegPath,
        args,
        options.partialPath,
        options.durationSec,
        options.onProgress,
      );
      if (result.cancelled || record.cancelled) {
        await removePartial(options.partialPath);
        return { status: 'cancelled' };
      }
      if (result.spawnError) {
        await removePartial(options.partialPath);
        return { status: 'error', message: explainSpawnError(result.spawnError).replace(/^Export failed/, 'Proxy generation failed') };
      }
      if (result.code === 0) {
        await fs.rename(options.partialPath, options.finalPath);
        return { status: 'done' };
      }
      const retry = nextProxyAttempt({ hwaccel, includeAudio, stderr: result.stderr });
      if (!retry) {
        await removePartial(options.partialPath);
        console.error('EditPro proxy ffmpeg failed', result.stderr.slice(-2000));
        return { status: 'error', message: explainProxyFailure(result.stderr) };
      }
      hwaccel = retry.hwaccel;
      includeAudio = retry.includeAudio;
    }
    await removePartial(options.partialPath);
    return { status: 'error', message: 'Proxy generation failed. Playback will keep using the original.' };
  } finally {
    jobs.delete(options.jobId);
    pendingCancel.delete(options.jobId);
  }
}

export function probeWithFfmpeg(
  ffmpegPath: string,
  inputPath: string,
  isCancelled?: () => boolean,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', inputPath], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, 20000);
    const poll = setInterval(() => {
      if (isCancelled?.()) child.kill('SIGTERM');
    }, 150);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      if (error) reject(error);
      else resolve(stderr);
    };
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 200000) stderr = stderr.slice(-150000);
    });
    child.on('error', (error) => finish(error));
    child.on('close', () => finish());
  });
}
