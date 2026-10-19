/**
 * Spawns the bundled ffmpeg binary. Progress is parsed from `-progress pipe:1`.
 * Cancel uses SIGTERM, or taskkill /t /f on Windows so the ffmpeg tree actually dies.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { firstExistingFont, formatCube, isHardwareEncoderFailure, parseEncoderList } from './creative.js';
import {
  buildExportPlan,
  createProgressParser,
  explainFfmpegFailure,
  explainSpawnError,
  ffmpegStopAction,
  isMissingAudioError,
  type ExportJob,
  type ProgressUpdate,
} from './plan.js';

interface ActiveJob {
  child: ChildProcess;
  cancelled: boolean;
  outputPath: string;
}

const jobs = new Map<string, ActiveJob>();
const pendingCancel = new Set<string>();

export function probeEncoders(ffmpegPath: string): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-encoders'], { windowsHide: true });
    let text = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    child.on('error', () => resolve([]));
    child.on('close', () => resolve(parseEncoderList(text)));
  });
}

export function hasActiveExport(): boolean {
  return jobs.size > 0;
}

export function cancelExportJob(jobId: string): void {
  pendingCancel.add(jobId);
  const job = jobs.get(jobId);
  if (!job || job.cancelled) return;
  job.cancelled = true;
  stopProcess(job.child);
}

export function cancelAllExports(): void {
  for (const jobId of jobs.keys()) cancelExportJob(jobId);
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

async function removePartial(outputPath: string): Promise<void> {
  try {
    await fs.unlink(outputPath);
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
  outputPath: string,
  outputDurationSec: number,
  onProgress: (update: ProgressUpdate) => void
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    if (pendingCancel.has(jobId)) {
      resolve({ code: null, stderr: '', cancelled: true, spawnError: null });
      return;
    }
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record: ActiveJob = { child, cancelled: false, outputPath };
    jobs.set(jobId, record);
    const parser = createProgressParser();
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const update of parser.push(chunk.toString('utf8'), outputDurationSec)) {
        onProgress(update);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 20000) stderr = stderr.slice(-14000);
    });

    const finish = (result: SpawnResult) => {
      jobs.delete(jobId);
      resolve(result);
    };

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ code: null, stderr: error.message ?? '', cancelled: false, spawnError: error });
    });
    child.on('close', (code) => {
      finish({
        code,
        stderr,
        cancelled: record.cancelled || pendingCancel.has(jobId),
        spawnError: null,
      });
    });
  });
}

export interface ExportRunResult {
  status: 'done' | 'cancelled' | 'error';
  outputPath: string;
  message?: string;
}

async function writeLutCube(job: ExportJob): Promise<string | null> {
  if (!job.creative?.lut) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'editpro-lut-'));
  const file = path.join(dir, 'grade.cube');
  await fs.writeFile(file, formatCube(job.creative.lut), 'utf8');
  return file;
}

function softwareJob(job: ExportJob): ExportJob {
  return {
    ...job,
    options: { ...job.options, encoder: 'software' },
  };
}

export async function runFfmpegExport(options: {
  ffmpegPath: string;
  job: ExportJob;
  onProgress: (update: ProgressUpdate) => void;
}): Promise<ExportRunResult> {
  const { ffmpegPath, job, onProgress } = options;
  const fontFile = firstExistingFont((candidate) => {
    try {
      return fsSync.existsSync(candidate);
    } catch {
      return false;
    }
  });
  let lutCubePath: string | null = null;
  try {
    lutCubePath = await writeLutCube(job);
  } catch {
    return {
      status: 'error',
      outputPath: job.outputPath,
      message: 'Export failed: the LUT cube could not be written to a temp file.',
    };
  }

  const planOptions = { lutCubePath, fontFile };
  let activeJob = job;
  let plan = buildExportPlan(activeJob, { includeAudio: true, ...planOptions });
  let fellBackToSoftware = false;
  try {
    try {
      await fs.access(path.dirname(plan.outputPath));
    } catch {
      return {
        status: 'error',
        outputPath: plan.outputPath,
        message: 'The output folder does not exist. Choose a folder that is already on disk.',
      };
    }

    const attempt = async (includeAudio: boolean) => {
      plan = buildExportPlan(activeJob, { includeAudio, ...planOptions });
      return spawnOnce(activeJob.jobId, ffmpegPath, plan.args, plan.outputPath, plan.outputDurationSec, onProgress);
    };

    let result = await attempt(true);
    if (result.cancelled) {
      await removePartial(plan.outputPath);
      pendingCancel.delete(job.jobId);
      return { status: 'cancelled', outputPath: plan.outputPath };
    }
    if (result.spawnError) {
      await removePartial(plan.outputPath);
      return { status: 'error', outputPath: plan.outputPath, message: explainSpawnError(result.spawnError) };
    }
    const hardware = (activeJob.options.encoder ?? 'software') !== 'software';
    if (result.code !== 0 && hardware && isHardwareEncoderFailure(result.stderr)) {
      await removePartial(plan.outputPath);
      activeJob = softwareJob(job);
      fellBackToSoftware = true;
      result = await attempt(true);
      if (result.cancelled) {
        await removePartial(plan.outputPath);
        pendingCancel.delete(job.jobId);
        return { status: 'cancelled', outputPath: plan.outputPath };
      }
      if (result.spawnError) {
        await removePartial(plan.outputPath);
        return { status: 'error', outputPath: plan.outputPath, message: explainSpawnError(result.spawnError) };
      }
    }
    if (result.code !== 0 && plan.canRetryWithoutAudio && isMissingAudioError(result.stderr)) {
      await removePartial(plan.outputPath);
      result = await attempt(false);
      if (result.cancelled) {
        await removePartial(plan.outputPath);
        pendingCancel.delete(job.jobId);
        return { status: 'cancelled', outputPath: plan.outputPath };
      }
      if (result.spawnError) {
        await removePartial(plan.outputPath);
        return { status: 'error', outputPath: plan.outputPath, message: explainSpawnError(result.spawnError) };
      }
      if (result.code === 0) {
        pendingCancel.delete(job.jobId);
        return {
          status: 'done',
          outputPath: plan.outputPath,
          message: fellBackToSoftware
            ? 'Exported picture only with the software encoder — the hardware encoder was unavailable and the source has no audio stream.'
            : 'Exported picture only — the source file has no audio stream.',
        };
      }
    }
    if (result.code === 0) {
      pendingCancel.delete(job.jobId);
      return {
        status: 'done',
        outputPath: plan.outputPath,
        message: fellBackToSoftware
          ? 'Hardware encoder was unavailable, so this file was encoded with the software encoder.'
          : undefined,
      };
    }
    await removePartial(plan.outputPath);
    pendingCancel.delete(job.jobId);
    return {
      status: 'error',
      outputPath: plan.outputPath,
      message: explainFfmpegFailure(result.code, result.stderr),
    };
  } finally {
    if (lutCubePath) {
      await fs.rm(path.dirname(lutCubePath), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
