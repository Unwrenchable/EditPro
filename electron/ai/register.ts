/**
 * Silence detection and a rendered cut. ffmpeg only — no model download.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { renderCut } from './cuts/run.js';
import type { AiHost } from './host.js';
import { cancelAiJob, cancelAllAiJobs, withAiJob } from './jobs.js';
import { detectSilence } from './silence/run.js';

export { cancelAllAiJobs };

interface TimeRange {
  start: number;
  end: number;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function sourcePathOf(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0')) {
    throw new Error('Choose a video that was opened from disk');
  }
  return value;
}

function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} is out of range`);
  }
  return value;
}

function parseSilenceRequest(value: unknown): {
  sourcePath: string;
  noiseDb: number;
  minDuration: number;
  padding: number;
} {
  const body = record(value);
  if (!body) throw new Error('The silence request is invalid');
  return {
    sourcePath: sourcePathOf(body.sourcePath),
    noiseDb: finite(typeof body.noiseDb === 'number' ? body.noiseDb : -35, 'Noise threshold', -60, -15),
    minDuration: finite(typeof body.minDuration === 'number' ? body.minDuration : 0.45, 'Minimum silence', 0.1, 5),
    padding: finite(typeof body.padding === 'number' ? body.padding : 0.08, 'Padding', 0, 0.5),
  };
}

function parseRanges(value: unknown): TimeRange[] {
  if (!Array.isArray(value) || value.length > 5000) throw new Error('Too many cut ranges');
  return value.map((item) => {
    const body = record(item);
    if (!body) throw new Error('A cut range is invalid');
    const start = finite(body.start, 'Cut time', 0, 86400);
    const end = finite(body.end, 'Cut time', 0, 86400);
    if (end <= start) throw new Error('A cut range is invalid');
    return { start, end };
  });
}

async function chosenOutput(host: AiHost, event: IpcMainInvokeEvent): Promise<string | null> {
  const picked = await host.pickSave(event, {
    title: 'Save the cut',
    defaultName: 'editpro-cut.mp4',
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });
  if (!picked) return null;
  const output = host.assertWritable(picked);
  await host.assertRegular(output);
  return output;
}

export function registerOfflineAi(host: AiHost): void {
  ipcMain.handle('ai:status', (event) => {
    host.assertTrusted(event);
    return { platform: host.platform, arch: host.arch };
  });

  ipcMain.handle('ai:cancel', (event, jobId: unknown) => {
    host.assertTrusted(event);
    if (typeof jobId !== 'string' || jobId.length === 0) return false;
    return cancelAiJob(jobId);
  });

  ipcMain.handle('ai:detectSilence', async (event, payload: unknown) => {
    host.assertTrusted(event);
    const request = parseSilenceRequest(payload);
    const sourcePath = await host.assertReadable(request.sourcePath);
    return withAiJob(host, event, async ({ signal, progress }) => {
      progress(15, 'Listening for silence');
      const found = await detectSilence({
        ffmpegPath: await host.ffmpegPath(),
        sourcePath,
        noiseDb: request.noiseDb,
        minDuration: request.minDuration,
        padding: request.padding,
        signal,
      });
      progress(100, found.ranges.length === 0 ? 'No silence found' : `Found ${found.ranges.length} silent stretches`);
      return found;
    });
  });

  ipcMain.handle('ai:renderCut', async (event, payload: unknown) => {
    host.assertTrusted(event);
    const body = record(payload);
    if (!body) throw new Error('The cut request is invalid');
    const sourcePath = await host.assertReadable(sourcePathOf(body.sourcePath));
    const ranges = parseRanges(body.ranges);
    const output = await chosenOutput(host, event);
    if (!output) return { outputPath: null };
    return withAiJob(host, event, async ({ signal, progress }) => {
      await renderCut({
        ffmpegPath: await host.ffmpegPath(),
        sourcePath,
        outputPath: output,
        ranges,
        signal,
        onProgress: progress,
      });
      host.grantRead(output);
      host.persistGrants();
      return { outputPath: output };
    });
  });
}
