/**
 * Local Whisper captions, filler removal, and transcript edits.
 * The CLI and ggml models download into user data. They are not bundled.
 */
import fs from 'node:fs/promises';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { ensureMatteModel, matteModelPath, removeBackground } from './background/run.js';
import { formatSrt, formatVtt } from './captions/format.js';
import { burnCaptions, ensureWhisperCli, ensureWhisperModel, speechStatus, transcribeSource } from './captions/run.js';
import { MATTE_MODEL } from './catalog.js';
import { renderCut } from './cuts/run.js';
import { fileSized } from './download.js';
import type { AiHost, SavePick } from './host.js';
import { cancelAiJob, cancelAllAiJobs, withAiJob } from './jobs.js';
import {
  parseBackgroundRequest,
  parseCaptionFormat,
  parseCues,
  parseCutRequest,
  parseDownloadRequest,
  parseSceneRequest,
  parseSilenceRequest,
  parseSourcePath,
  parseTranscribeRequest,
} from './payload.js';
import { detectScenes } from './scenes/run.js';
import { detectSilence } from './silence/run.js';

export { cancelAllAiJobs };

async function chosenOutput(host: AiHost, event: IpcMainInvokeEvent, options: SavePick): Promise<string | null> {
  const picked = await host.pickSave(event, options);
  if (!picked) return null;
  const output = host.assertWritable(picked);
  await host.assertRegular(output);
  return output;
}

export function registerOfflineAi(host: AiHost): void {
  ipcMain.handle('ai:status', async (event) => {
    host.assertTrusted(event);
    const speech = await speechStatus({
      userData: host.userData(),
      platform: host.platform,
      arch: host.arch,
    });
    return {
      platform: host.platform,
      arch: host.arch,
      whisperCli: speech.cli,
      models: speech.models,
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

  ipcMain.handle('ai:download', async (event, payload: unknown) => {
    host.assertTrusted(event);
    const request = parseDownloadRequest(payload);
    return withAiJob(host, event, async ({ signal, progress }) => {
      if (request.kind === 'matte') {
        await ensureMatteModel(host.userData(), {
          signal,
          onProgress: (loaded, total) => progress(total ? (loaded / total) * 100 : 10, 'Downloading the matting model'),
        });
        return { ready: true };
      }
      const paths = { userData: host.userData(), platform: host.platform, arch: host.arch };
      if (request.kind === 'cli') {
        await ensureWhisperCli(paths, {
          signal,
          onProgress: (loaded, total) => progress(total ? (loaded / total) * 100 : 10, 'Downloading whisper.cpp'),
        });
        return { ready: true };
      }
      await ensureWhisperModel(host.userData(), request.modelId, {
        signal,
        onProgress: (loaded, total) => progress(total ? (loaded / total) * 100 : 10, 'Downloading the speech model'),
      });
      return { ready: true };
    });
  });

  ipcMain.handle('ai:transcribe', async (event, payload: unknown) => {
    host.assertTrusted(event);
    const request = parseTranscribeRequest(payload);
    const sourcePath = await host.assertReadable(request.sourcePath);
    return withAiJob(host, event, async ({ signal, progress }) => {
      const cues = await transcribeSource({
        ffmpegPath: await host.ffmpegPath(),
        paths: { userData: host.userData(), platform: host.platform, arch: host.arch },
        sourcePath,
        modelId: request.modelId,
        language: request.language,
        signal,
        onProgress: progress,
      });
      return { cues };
    });
  });

  ipcMain.handle('ai:saveCaptions', async (event, payload: unknown) => {
    host.assertTrusted(event);
    const body = payload && typeof payload === 'object' ? payload as { cues?: unknown; format?: unknown } : {};
    const cues = parseCues(body.cues);
    const format = parseCaptionFormat(body.format);
    if (cues.length === 0) throw new Error('There are no captions to save');
    const extension = format === 'vtt' ? 'vtt' : 'srt';
    const output = await chosenOutput(host, event, {
      title: format === 'vtt' ? 'Save WebVTT captions' : 'Save SubRip captions',
      defaultName: `captions.${extension}`,
      filters: [{ name: format === 'vtt' ? 'WebVTT' : 'SubRip', extensions: [extension] }],
    });
    if (!output) return { outputPath: null };
    const text = format === 'vtt' ? formatVtt(cues) : formatSrt(cues);
    await fs.writeFile(output, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    host.grantRead(output);
    host.persistGrants();
    return { outputPath: output };
  });

  ipcMain.handle('ai:burnCaptions', async (event, payload: unknown) => {
    host.assertTrusted(event);
    const body = payload && typeof payload === 'object' ? payload as { sourcePath?: unknown; cues?: unknown } : {};
    const cues = parseCues(body.cues);
    const sourcePath = await host.assertReadable(parseSourcePath(body.sourcePath));
    const output = await chosenOutput(host, event, {
      title: 'Burn captions into a video',
      defaultName: 'captions-burned.mp4',
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    });
    if (!output) return { outputPath: null };
    return withAiJob(host, event, async ({ signal, progress }) => {
      await burnCaptions({
        ffmpegPath: await host.ffmpegPath(),
        sourcePath,
        outputPath: output,
        cues,
        signal,
        onProgress: progress,
      });
      host.grantRead(output);
      host.persistGrants();
      return { outputPath: output };
    });
  });

  ipcMain.handle('ai:renderCut', async (event, payload: unknown) => {
    host.assertTrusted(event);
    const request = parseCutRequest(payload);
    const sourcePath = await host.assertReadable(request.sourcePath);
    const output = await chosenOutput(host, event, {
      title: 'Save the cut',
      defaultName: 'editpro-cut.mp4',
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    });
    if (!output) return { outputPath: null };
    return withAiJob(host, event, async ({ signal, progress }) => {
      await renderCut({
        ffmpegPath: await host.ffmpegPath(),
        sourcePath,
        outputPath: output,
        ranges: request.ranges,
        signal,
        onProgress: progress,
      });
      host.grantRead(output);
      host.persistGrants();
      return { outputPath: output };
    });
  });

  ipcMain.handle('ai:removeBackground', async (event, payload: unknown) => {
    host.assertTrusted(event);
    const request = parseBackgroundRequest(payload);
    const sourcePath = await host.assertReadable(request.sourcePath);
    const transparent = request.mode === 'transparent';
    const output = await chosenOutput(host, event, {
      title: 'Save the matted video',
      defaultName: transparent ? 'matte.webm' : 'matte.mp4',
      filters: transparent
        ? [{ name: 'WebM with alpha', extensions: ['webm'] }]
        : [{ name: 'MP4 Video', extensions: ['mp4'] }],
    });
    if (!output) return { outputPath: null };
    return withAiJob(host, event, async ({ signal, progress }) => {
      await removeBackground({
        ffmpegPath: await host.ffmpegPath(),
        userData: host.userData(),
        sourcePath,
        outputPath: output,
        mode: request.mode,
        color: request.color,
        signal,
        onProgress: progress,
      });
      host.grantRead(output);
      host.persistGrants();
      return { outputPath: output };
    });
  });
}
