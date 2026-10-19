import { Muxer, ArrayBufferTarget } from 'webm-muxer';
import { abortError, throwIfAborted } from './abort';

export interface FrameExportOptions {
  source: Blob;
  width: number;
  height: number;
  fps: number;
  trimStart: number;
  trimEnd: number;
  signal: AbortSignal;
  onProgress: (percent: number, timeSec?: number) => void;
}

async function loadVideo(source: Blob, signal: AbortSignal): Promise<{ video: HTMLVideoElement; revoke: () => void }> {
  throwIfAborted(signal);
  const url = URL.createObjectURL(source);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('This browser could not read the video file.'));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort);
  });
  return {
    video,
    revoke: () => URL.revokeObjectURL(url),
  };
}

async function seek(video: HTMLVideoElement, time: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (Math.abs(video.currentTime - time) < 0.04 && video.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Could not seek to a frame in this video.'));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort);
    video.currentTime = time;
  });
}

function even(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

/**
 * Fast picture encode. Audio, titles, and the filter graph are left to
 * ffmpeg.wasm or the desktop binary — the dialog says so.
 */
export async function exportWithWebCodecs(options: FrameExportOptions): Promise<Blob> {
  if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') {
    throw new Error('WebCodecs (VideoEncoder) is not available in this browser.');
  }
  const width = even(options.width);
  const height = even(options.height);
  const fps = Math.max(1, Math.min(60, Math.round(options.fps) || 30));
  const duration = Math.max(0.05, options.trimEnd - options.trimStart);
  const frameCount = Math.max(1, Math.round(duration * fps));
  if (frameCount > 18_000) {
    throw new Error('This clip is too long for a frame-by-frame WebCodecs export. Use the desktop ffmpeg or ffmpeg.wasm.');
  }
  const { video, revoke } = await loadVideo(options.source, options.signal);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    revoke();
    throw new Error('Canvas export is not available in this browser.');
  }
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'V_VP9', width, height, frameRate: fps },
    firstTimestampBehavior: 'offset',
  });
  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encoderError = error instanceof Error ? error : new Error('WebCodecs encoder failed.');
    },
  });
  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate: 2_500_000,
      framerate: fps,
    });
    if (!support.supported) {
      throw new Error('This browser does not support VP9 WebCodecs encoding.');
    }
    encoder.configure({
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate: 2_500_000,
      framerate: fps,
    });
    for (let frame = 0; frame < frameCount; frame += 1) {
      throwIfAborted(options.signal);
      if (encoderError) throw encoderError;
      const time = Math.min(options.trimEnd, options.trimStart + frame / fps);
      await seek(video, time, options.signal);
      context.drawImage(video, 0, 0, width, height);
      const timestamp = Math.round((frame * 1_000_000) / fps);
      const videoFrame = new VideoFrame(canvas, { timestamp, duration: Math.round(1_000_000 / fps) });
      encoder.encode(videoFrame, { keyFrame: frame % (fps * 2) === 0 });
      videoFrame.close();
      options.onProgress(Math.round(((frame + 1) / frameCount) * 100), time - options.trimStart);
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/webm' });
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    revoke();
  }
}
