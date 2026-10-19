/**
 * Frame clock for the program monitor.
 *
 * HTMLMediaElement.currentTime is a continuous timestamp. Phone video and 4K
 * masters are long-GOP, so a raw assignment can show the previous frame and a
 * play() promise that resolves after pause() starts the decoder anyway.
 * This module quantizes to frame boundaries, biases the element into that
 * frame, and treats a late play() as cancelled when pause won the race.
 * Dropped decoder frames move the playhead to the frame that was actually
 * shown. They never cause a catch-up seek, which would drop more frames.
 */
export const FALLBACK_FPS = 30;

export type PlaybackScale = 'full' | 'half' | 'quarter';

export interface TransportState {
  generation: number;
  playing: boolean;
  elementShouldPlay: boolean;
}

export interface DropState {
  mediaTime: number;
  dropped: number;
  primed: boolean;
}

export interface PlaybackClock {
  transport: TransportState;
  presentedMediaTime: number;
  drop: DropState;
  usingFrameCallback: boolean;
  stopFrames: () => void;
}

export function createPlaybackClock(): PlaybackClock {
  return {
    transport: { generation: 0, playing: false, elementShouldPlay: false },
    presentedMediaTime: 0,
    drop: { mediaTime: 0, dropped: 0, primed: false },
    usingFrameCallback: false,
    stopFrames() {},
  };
}

export function sanitizeFps(fps: number): number {
  if (!Number.isFinite(fps) || fps < 1 || fps > 480) return FALLBACK_FPS;
  return fps;
}

export function readElementFps(video: { dataset?: { frameRate?: string } }): number {
  const raw = Number(video.dataset?.frameRate);
  return sanitizeFps(raw);
}

export function frameIndexAt(timeSec: number, fps: number): number {
  const rate = sanitizeFps(fps);
  if (!Number.isFinite(timeSec) || timeSec <= 0) return 0;
  return Math.max(0, Math.round(timeSec * rate));
}

export function frameBoundary(timeSec: number, fps: number): number {
  const rate = sanitizeFps(fps);
  return frameIndexAt(timeSec, rate) / rate;
}

/** Land slightly inside the frame so decoders that floor still show it. */
export function presentationTimeForBoundary(boundary: number, fps: number, duration: number): number {
  const rate = sanitizeFps(fps);
  const bias = 0.15 / rate;
  const time = boundary + bias;
  if (duration > 0 && time >= duration) return Math.max(0, Math.min(boundary, duration - 1e-4));
  return time;
}

export function seekFrameTime(time: number, fps: number, duration: number): number {
  const rate = sanitizeFps(fps);
  const limit = duration > 0 ? duration : 0;
  const clamped = Math.min(Math.max(0, time), limit);
  const index = frameIndexAt(clamped, rate);
  if (duration > 0) {
    const maxIndex = Math.max(0, Math.round(duration * rate));
    return Math.min(index, maxIndex) / rate;
  }
  return index / rate;
}

export function stepFrameTime(currentTime: number, direction: 1 | -1, fps: number, duration: number): number {
  const rate = sanitizeFps(fps);
  const index = frameIndexAt(currentTime, rate) + direction;
  const maxIndex = duration > 0 ? Math.max(0, Math.round(duration * rate)) : Math.max(0, index);
  const clamped = Math.min(Math.max(0, index), maxIndex);
  return clamped / rate;
}

/**
 * True when pause must assign currentTime. Skipping the seek leaves the
 * decoder parked on the visible frame so the next play does not drop it.
 */
export function shouldReseekOnPause(currentTime: number, snapBoundary: number, fps: number): boolean {
  const rate = sanitizeFps(fps);
  return Math.abs(currentTime - snapBoundary) > 0.45 / rate;
}

export function transportPlay(state: TransportState): { state: TransportState; generation: number } {
  const generation = state.generation + 1;
  return {
    generation,
    state: { generation, playing: true, elementShouldPlay: false },
  };
}

export function transportPlayResolved(state: TransportState, generation: number): TransportState {
  if (state.generation !== generation) return state;
  return { ...state, elementShouldPlay: true };
}

export function transportPause(state: TransportState): TransportState {
  return { generation: state.generation + 1, playing: false, elementShouldPlay: false };
}

/** Invalidate an in-flight play() when the clip changes. */
export function resetPlaybackClock(clock: PlaybackClock): void {
  clock.stopFrames();
  clock.stopFrames = () => {};
  clock.transport = transportPause(clock.transport);
  clock.usingFrameCallback = false;
  clock.presentedMediaTime = 0;
  clock.drop = { mediaTime: 0, dropped: 0, primed: false };
}

export interface ClockAdvance {
  mediaTime: number;
  dropped: number;
  primed: boolean;
  droppedNow: boolean;
}

/**
 * Follow the frame the decoder presented. A gap larger than one frame counts
 * as drops and does not move the clock past `presented`.
 */
export function advancePlaybackClock(state: DropState, presented: number, frameDur: number): ClockAdvance {
  if (!Number.isFinite(presented)) {
    return { ...state, droppedNow: false };
  }
  if (!state.primed || presented + 1e-4 < state.mediaTime) {
    return { mediaTime: presented, dropped: state.dropped, primed: true, droppedNow: false };
  }
  const gap = presented - state.mediaTime;
  const safeDur = frameDur > 0 ? frameDur : 1 / FALLBACK_FPS;
  if (gap <= safeDur * 1.5) {
    return { mediaTime: presented, dropped: state.dropped, primed: true, droppedNow: false };
  }
  const skipped = Math.max(1, Math.round(gap / safeDur) - 1);
  return { mediaTime: presented, dropped: state.dropped + skipped, primed: true, droppedNow: true };
}

export function selectPreviewUrl(options: {
  originalUrl: string | null;
  proxyUrl: string | null;
  useProxy: boolean;
}): string | null {
  if (options.useProxy && options.proxyUrl) return options.proxyUrl;
  return options.originalUrl;
}

/** The file ffmpeg exports. Preview URLs, including proxy tickets, are ignored. */
export function exportSourcePath(originalPath: string | null): string | null {
  return originalPath;
}

export function monitorScale(options: { showingProxy: boolean; resolution: PlaybackScale }): 1 | 2 | 4 {
  if (options.showingProxy || options.resolution === 'full') return 1;
  if (options.resolution === 'half') return 2;
  return 4;
}

export function resolutionLabel(scale: PlaybackScale): string {
  if (scale === 'full') return 'Full';
  if (scale === 'half') return '1/2';
  return '1/4';
}

export function subscribePresentedFrames(
  video: HTMLVideoElement,
  generation: number,
  getGeneration: () => number,
  onFrame: (mediaTime: number) => void,
): () => void {
  const request = video.requestVideoFrameCallback?.bind(video);
  if (!request) return () => {};
  let stopped = false;
  let handle = 0;
  const step = (_now: number, metadata: { mediaTime: number }) => {
    if (stopped || getGeneration() !== generation) return;
    if (Number.isFinite(metadata.mediaTime)) onFrame(metadata.mediaTime);
    if (stopped || getGeneration() !== generation) return;
    handle = request(step);
  };
  handle = request(step);
  return () => {
    stopped = true;
    video.cancelVideoFrameCallback?.(handle);
  };
}
