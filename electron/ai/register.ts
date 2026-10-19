/**
 * Scene-detection IPC. ffmpeg scores frame changes. No model download.
 */
import { ipcMain } from 'electron';
import type { AiHost } from './host.js';
import { cancelAiJob, cancelAllAiJobs, withAiJob } from './jobs.js';
import { detectScenes } from './scenes/run.js';

export { cancelAllAiJobs };

function parseSceneRequest(value: unknown): { sourcePath: string; threshold: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The scene request is invalid');
  }
  const body = value as { sourcePath?: unknown; threshold?: unknown };
  if (typeof body.sourcePath !== 'string' || body.sourcePath.length === 0 || body.sourcePath.length > 4096 || body.sourcePath.includes('\0')) {
    throw new Error('Choose a video that was opened from disk');
  }
  const threshold = typeof body.threshold === 'number' ? body.threshold : 0.3;
  if (!Number.isFinite(threshold) || threshold < 0.05 || threshold > 0.9) {
    throw new Error('Scene threshold is out of range');
  }
  return { sourcePath: body.sourcePath, threshold };
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

  ipcMain.handle('ai:detectScenes', async (event, payload: unknown) => {
    host.assertTrusted(event);
    const request = parseSceneRequest(payload);
    const sourcePath = await host.assertReadable(request.sourcePath);
    return withAiJob(host, event, async ({ signal, progress }) => {
      progress(15, 'Scoring scene changes');
      const hits = await detectScenes({
        ffmpegPath: await host.ffmpegPath(),
        sourcePath,
        threshold: request.threshold,
        signal,
      });
      progress(100, hits.length === 0 ? 'No scene changes found' : `Found ${hits.length} scene changes`);
      return { hits };
    });
  });
}
