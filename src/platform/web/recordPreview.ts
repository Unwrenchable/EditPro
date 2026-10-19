import { abortError, throwIfAborted } from './abort';
import type { FrameExportOptions } from './webCodecsExport';

interface CaptureVideo extends HTMLVideoElement {
  captureStream?: () => MediaStream;
}

/**
 * Real-time recording of the trimmed picture, plus audio when the element
 * exposes a capture stream. Used when WebCodecs and ffmpeg.wasm cannot run.
 */
export async function exportWithMediaRecorder(options: FrameExportOptions & { playbackRate: number }): Promise<Blob> {
  if (typeof MediaRecorder !== 'function') {
    throw new Error('MediaRecorder is not available in this browser.');
  }
  const width = Math.max(2, Math.round(options.width));
  const height = Math.max(2, Math.round(options.height));
  const url = URL.createObjectURL(options.source);
  const video = document.createElement('video') as CaptureVideo;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('error', onError);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('This browser could not read the video file.'));
      };
      video.addEventListener('loadedmetadata', onReady);
      video.addEventListener('error', onError);
    });
    throwIfAborted(options.signal);
    video.currentTime = options.trimStart;
    await new Promise<void>((resolve) => {
      if (Math.abs(video.currentTime - options.trimStart) < 0.05) {
        resolve();
        return;
      }
      video.addEventListener('seeked', () => resolve(), { once: true });
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas export is not available in this browser.');
    const fps = Math.max(1, Math.min(30, Math.round(options.fps) || 30));
    const canvasStream = canvas.captureStream(fps);
    const captured = video.captureStream?.();
    for (const track of captured?.getAudioTracks() ?? []) canvasStream.addTrack(track);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : '';
    const recorder = mime ? new MediaRecorder(canvasStream, { mimeType: mime }) : new MediaRecorder(canvasStream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      recorder.addEventListener('error', () => reject(new Error('MediaRecorder failed while writing the file.')), { once: true });
    });
    recorder.start(200);
    video.playbackRate = options.playbackRate > 0 ? options.playbackRate : 1;
    await video.play();
    await new Promise<void>((resolve, reject) => {
      const draw = () => {
        if (options.signal.aborted) {
          resolve();
          return;
        }
        context.drawImage(video, 0, 0, width, height);
        const span = Math.max(0.05, options.trimEnd - options.trimStart);
        const percent = Math.round((Math.min(span, video.currentTime - options.trimStart) / span) * 100);
        options.onProgress(Math.max(0, Math.min(100, percent)), Math.max(0, video.currentTime - options.trimStart));
        if (video.currentTime >= options.trimEnd || video.ended) {
          resolve();
          return;
        }
        requestAnimationFrame(draw);
      };
      video.addEventListener('error', () => reject(new Error('Playback failed during recording.')), { once: true });
      draw();
    });
    video.pause();
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    if (options.signal.aborted) throw abortError();
    if (chunks.length === 0) throw new Error('MediaRecorder produced an empty file.');
    return new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
