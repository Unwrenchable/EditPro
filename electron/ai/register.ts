/**
 * Local portrait matting. The ONNX file downloads into user data; it is not bundled.
 */
import { ipcMain } from 'electron';
import { ensureMatteModel, matteModelPath, removeBackground } from './background/run.js';
import { MATTE_MODEL } from './catalog.js';
import { fileSized } from './download.js';
import type { AiHost } from './host.js';
import { cancelAiJob, cancelAllAiJobs, withAiJob } from './jobs.js';

export { cancelAllAiJobs };

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function registerOfflineAi(host: AiHost): void {
  ipcMain.handle('ai:status', async (event) => {
    host.assertTrusted(event);
    return {
      platform: host.platform,
      arch: host.arch,
      matte: {
        id: MATTE_MODEL.id,
        label: MATTE_MODEL.label,
        bytes: MATTE_MODEL.bytes,
        ready: await fileSized(matteModelPath(host.userData()), MATTE_MODEL.bytes),
      },
    };
  });

  ipcMain.handle('ai:cancel', (event, jobId: unknown) => {
    host.assertTrusted(event);
    if (typeof jobId !== 'string' || jobId.length === 0) return false;
    return cancelAiJob(jobId);
  });

  ipcMain.handle('ai:download', async (event, payload: unknown) => {
    host.assertTrusted(event);
    const body = record(payload);
    if (!body || body.kind !== 'matte') throw new Error('Unknown download');
    return withAiJob(host, event, async ({ signal, progress }) => {
      await ensureMatteModel(host.userData(), {
        signal,
        onProgress: (loaded, total) => progress(total ? (loaded / total) * 100 : 10, 'Downloading the matting model'),
      });
      return { ready: true };
    });
  });

  ipcMain.handle('ai:removeBackground', async (event, payload: unknown) => {
    host.assertTrusted(event);
    const body = record(payload);
    if (!body) throw new Error('The background request is invalid');
    if (typeof body.sourcePath !== 'string' || body.sourcePath.length === 0 || body.sourcePath.includes('\0')) {
      throw new Error('Choose a video that was opened from disk');
    }
    const mode = body.mode === 'color' ? 'color' : 'transparent';
    const color = typeof body.color === 'string' ? body.color : '00ff00';
    const sourcePath = await host.assertReadable(body.sourcePath);
    const transparent = mode === 'transparent';
    const picked = await host.pickSave(event, {
      title: 'Save the matted video',
      defaultName: transparent ? 'matte.webm' : 'matte.mp4',
      filters: transparent
        ? [{ name: 'WebM with alpha', extensions: ['webm'] }]
        : [{ name: 'MP4 Video', extensions: ['mp4'] }],
    });
    if (!picked) return { outputPath: null };
    const output = host.assertWritable(picked);
    await host.assertRegular(output);
    return withAiJob(host, event, async ({ signal, progress }) => {
      await removeBackground({
        ffmpegPath: await host.ffmpegPath(),
        userData: host.userData(),
        sourcePath,
        outputPath: output,
        mode,
        color,
        signal,
        onProgress: progress,
      });
      host.grantRead(output);
      host.persistGrants();
      return { outputPath: output };
    });
  });
}
