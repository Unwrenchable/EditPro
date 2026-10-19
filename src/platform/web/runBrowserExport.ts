import { buildExportPlan, outputSize, type ExportJob } from '../../utils/video/exportPlan';
import { exportFallbackOrder, type EncoderCaps } from '../engines';
import type { ExportEngine } from '../types';
import { rewriteFfmpegArgsForWasm } from './rewriteArgs';
import { exportWithFfmpegWasm } from './ffmpegWasm';
import { isAbortError, throwIfAborted } from './abort';
import { exportWithWebCodecs } from './webCodecsExport';
import { exportWithMediaRecorder } from './recordPreview';

export interface BrowserExportRequest {
  job: ExportJob;
  source: Blob;
  capabilities: EncoderCaps;
  signal: AbortSignal;
  onProgress: (percent: number, timeSec?: number) => void;
}

export interface BrowserExportOutput {
  blob: Blob;
  engine: Exclude<ExportEngine, 'native-ffmpeg' | 'none'>;
  message: string;
}

function mimeForName(name: string): string {
  if (name.endsWith('.webm')) return 'video/webm';
  if (name.endsWith('.mov')) return 'video/quicktime';
  return 'video/mp4';
}

/**
 * Try browser encoders in fidelity order.
 * ffmpeg.wasm runs the desktop export plan. WebCodecs and MediaRecorder keep
 * the trimmed picture when the wasm core cannot load.
 */
export async function runBrowserExport(request: BrowserExportRequest): Promise<BrowserExportOutput> {
  const order = exportFallbackOrder(request.capabilities).filter((engine) => engine !== 'native-ffmpeg');
  const reasons: string[] = [];
  for (const engine of order) {
    throwIfAborted(request.signal);
    try {
      if (engine === 'ffmpeg-wasm') {
        const plan = buildExportPlan(request.job);
        const rewritten = rewriteFfmpegArgsForWasm(plan.args, request.job.sourcePath, plan.outputPath);
        if (rewritten.blocked.length > 0) {
          throw new Error(
            `ffmpeg.wasm cannot open ${rewritten.blocked.length} desktop path${rewritten.blocked.length === 1 ? '' : 's'}. Open those clips in this browser, or export from the desktop app.`,
          );
        }
        const bytes = await exportWithFfmpegWasm({
          source: request.source,
          args: rewritten.args,
          outputName: rewritten.outputName,
          signal: request.signal,
          onProgress: request.onProgress,
        });
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        return {
          blob: new Blob([copy], { type: mimeForName(rewritten.outputName) }),
          engine: 'ffmpeg-wasm',
          message:
            'Encoded with ffmpeg.wasm in this browser, using the same export plan as the desktop ffmpeg (trim, color, audio, titles, transitions). Nothing was uploaded.',
        };
      }
      const size = outputSize(request.job.options.resolution, request.job.autoReframe);
      if (engine === 'webcodecs') {
        const blob = await exportWithWebCodecs({
          source: request.source,
          width: size.width,
          height: size.height,
          fps: request.job.options.frameRate,
          trimStart: request.job.trimStart,
          trimEnd: request.job.trimEnd,
          signal: request.signal,
          onProgress: request.onProgress,
        });
        return {
          blob,
          engine: 'webcodecs',
          message: fallbackMessage('webcodecs', reasons),
        };
      }
      if (engine === 'media-recorder') {
        const blob = await exportWithMediaRecorder({
          source: request.source,
          width: size.width,
          height: size.height,
          fps: request.job.options.frameRate,
          trimStart: request.job.trimStart,
          trimEnd: request.job.trimEnd,
          playbackRate: request.job.playbackRate,
          signal: request.signal,
          onProgress: request.onProgress,
        });
        return {
          blob,
          engine: 'media-recorder',
          message: fallbackMessage('media-recorder', reasons),
        };
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      reasons.push(error instanceof Error ? error.message : 'The browser encoder failed.');
    }
  }
  const reason = reasons.length > 0 ? ` ${reasons[reasons.length - 1]}` : '';
  throw new Error(
    `Video export runs in the EditPro desktop app, which bundles ffmpeg. This browser could not finish a WebCodecs, MediaRecorder, or ffmpeg.wasm encode.${reason}`,
  );
}

function fallbackMessage(engine: 'webcodecs' | 'media-recorder', reasons: string[]): string {
  const why = reasons.length > 0 ? ` ${reasons[reasons.length - 1]}` : '';
  if (engine === 'webcodecs') {
    return `Encoded with WebCodecs. The trimmed picture is kept.${why} Multicam, titles, and the full audio mix stay on the desktop ffmpeg or on ffmpeg.wasm when its core loads.`;
  }
  return `Recorded with MediaRecorder while the clip played. Trim is kept.${why} Multicam, titles, and the full audio mix stay on the desktop ffmpeg or on ffmpeg.wasm when its core loads.`;
}
