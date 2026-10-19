import { describe, expect, it } from 'vitest';
import {
  advancePlaybackClock,
  exportSourcePath,
  frameBoundary,
  monitorScale,
  presentationTimeForBoundary,
  readElementFps,
  seekFrameTime,
  selectPreviewUrl,
  shouldReseekOnPause,
  stepFrameTime,
  resetPlaybackClock,
  transportPause,
  transportPlay,
  transportPlayResolved,
  createPlaybackClock,
} from './frameClock';

describe('frame clock', () => {
  it('quantizes seeks onto frame boundaries and biases the element into the frame', () => {
    expect(readElementFps({ dataset: { frameRate: '24' } })).toBe(24);
    expect(readElementFps({})).toBe(30);
    expect(seekFrameTime(1, 24, 10)).toBe(1);
    expect(presentationTimeForBoundary(1, 24, 10)).toBeCloseTo(1 + 0.15 / 24, 8);
    expect(frameBoundary(presentationTimeForBoundary(1, 24, 10), 24)).toBe(1);
    expect(stepFrameTime(0, 1, 24, 10)).toBeCloseTo(1 / 24, 8);
    expect(stepFrameTime(0, -1, 24, 10)).toBe(0);
    expect(seekFrameTime(4, 30, 0)).toBe(0);
  });

  it('does not reseek on pause when the visible frame is already showing', () => {
    const boundary = frameBoundary(1, 30);
    expect(shouldReseekOnPause(presentationTimeForBoundary(boundary, 30, 10), boundary, 30)).toBe(false);
    expect(shouldReseekOnPause(boundary + 1, boundary, 30)).toBe(true);
  });

  it('keeps a late play() from overriding pause', () => {
    const started = transportPlay({ generation: 0, playing: false, elementShouldPlay: false });
    const paused = transportPause(started.state);
    const late = transportPlayResolved(paused, started.generation);
    expect(late.playing).toBe(false);
    expect(late.elementShouldPlay).toBe(false);
    expect(late.generation).toBe(paused.generation);

    const again = transportPlay(paused);
    const resolved = transportPlayResolved(again.state, again.generation);
    expect(resolved.playing).toBe(true);
    expect(resolved.elementShouldPlay).toBe(true);

    const clock = createPlaybackClock();
    clock.transport = resolved;
    clock.presentedMediaTime = 3;
    resetPlaybackClock(clock);
    expect(clock.transport.playing).toBe(false);
    expect(clock.presentedMediaTime).toBe(0);
    expect(clock.transport.generation).toBe(resolved.generation + 1);
  });

  it('counts dropped frames without skipping past the presented frame', () => {
    const primed = advancePlaybackClock({ mediaTime: 0, dropped: 0, primed: false }, 1, 1 / 30);
    const jumped = advancePlaybackClock(
      { mediaTime: primed.mediaTime, dropped: primed.dropped, primed: primed.primed },
      1.5,
      1 / 30,
    );
    expect(jumped.droppedNow).toBe(true);
    expect(jumped.mediaTime).toBe(1.5);
    expect(jumped.dropped).toBeGreaterThan(0);
  });

  it('plays the proxy in the monitor and exports the original', () => {
    expect(
      selectPreviewUrl({ originalUrl: 'blob:camera', proxyUrl: 'media://clip/abc', useProxy: true }),
    ).toBe('media://clip/abc');
    expect(
      selectPreviewUrl({ originalUrl: 'blob:camera', proxyUrl: 'media://clip/abc', useProxy: false }),
    ).toBe('blob:camera');
    expect(exportSourcePath('/films/A001.mov')).toBe('/films/A001.mov');
    expect(monitorScale({ showingProxy: true, resolution: 'quarter' })).toBe(1);
    expect(monitorScale({ showingProxy: false, resolution: 'half' })).toBe(2);
    expect(monitorScale({ showingProxy: false, resolution: 'quarter' })).toBe(4);
    expect(monitorScale({ showingProxy: false, resolution: 'full' })).toBe(1);
  });
});
