import { describe, expect, it } from 'vitest';
import type { TimelineClip, TimelineTrack } from '../types';
import { createDefaultPhotoEdits, createDefaultVideoEdits, normalizeVideoEdits } from '../utils/editSnapshots';
import { createProject, parseProject, serializeProject } from '../utils/projectFile';
import {
  collectSnapPoints,
  displayTrackOrder,
  liftDelete,
  linkPair,
  moveClipTo,
  rippleDelete,
  rippleTrimTo,
  rippleTrimToPlayhead,
  rollTo,
  slideTo,
  slipTo,
  snapTime,
  insertProgramClip,
  splitClip,
  trackEnd,
  trimEdgeTo,
  unlinkClip,
} from '../utils/video/timelineEdit';

const tracks: TimelineTrack[] = [
  { id: 'v1', type: 'video', name: 'V1', muted: false, locked: false },
  { id: 'v2', type: 'video', name: 'V2', muted: false, locked: false },
  { id: 'a1', type: 'audio', name: 'A1', muted: false, locked: false },
  { id: 'a2', type: 'audio', name: 'A2', muted: false, locked: false },
];

function clip(partial: Partial<TimelineClip> & Pick<TimelineClip, 'id' | 'trackId'>): TimelineClip {
  return {
    src: '/media/a.mp4',
    startTime: 0,
    endTime: 4,
    inPoint: 0,
    outPoint: 4,
    ...partial,
  };
}

describe('multi-track timeline edits', () => {
  const sequence = [
    clip({ id: 'a', trackId: 'v1', startTime: 0, endTime: 4, inPoint: 0, outPoint: 4 }),
    clip({ id: 'b', trackId: 'v1', startTime: 4, endTime: 8, inPoint: 0, outPoint: 4 }),
    clip({ id: 'c', trackId: 'v1', startTime: 8, endTime: 12, inPoint: 1, outPoint: 5 }),
    clip({ id: 'upper', trackId: 'v2', startTime: 0, endTime: 6, inPoint: 0, outPoint: 6 }),
    clip({ id: 'sound', trackId: 'a1', startTime: 0, endTime: 4, inPoint: 0, outPoint: 4, linkId: 'pair' }),
  ];

  it('stacks video tracks above audio tracks', () => {
    expect(displayTrackOrder(tracks).map((track) => track.id)).toEqual(['v2', 'v1', 'a1', 'a2']);
  });

  it('razors a clip and its linked partner, then ripple-deletes the tail', () => {
    const linked = sequence.map((item) => (item.id === 'a' ? { ...item, linkId: 'pair' } : item));
    let ids = 0;
    const cut = splitClip(linked, tracks, 'a', 2, () => `n${ids += 1}`);
    const left = cut.find((item) => item.id === 'a');
    const right = cut.find((item) => item.id !== 'a' && item.trackId === 'v1' && item.startTime === 2);
    const soundRight = cut.find((item) => item.trackId === 'a1' && item.startTime === 2);
    expect(left).toMatchObject({ endTime: 2, outPoint: 2, linkId: 'pair' });
    expect(right?.linkId).toBe(soundRight?.linkId);
    expect(right?.linkId).not.toBe('pair');
    expect(cut.find((item) => item.id === 'upper')?.endTime).toBe(6);

    const closed = rippleDelete(cut, tracks, [right!.id]);
    expect(closed.some((item) => item.id === right!.id || item.id === soundRight!.id)).toBe(false);
    expect(closed.find((item) => item.id === 'b')).toMatchObject({ startTime: 2, endTime: 6 });
    expect(closed.find((item) => item.id === 'upper')?.startTime).toBe(0);
  });

  it('lifts without closing the gap and ripples the following clips', () => {
    expect(liftDelete(sequence, tracks, ['b']).find((item) => item.id === 'c')?.startTime).toBe(8);
    expect(rippleDelete(sequence, tracks, ['b']).find((item) => item.id === 'c')).toMatchObject({ startTime: 4, endTime: 8 });
  });

  it('trims, ripples, rolls, slips, and slides', () => {
    expect(trimEdgeTo(sequence, tracks, 'a', 'out', 3).find((item) => item.id === 'a')).toMatchObject({ endTime: 3, outPoint: 3 });
    expect(trimEdgeTo(sequence, tracks, 'a', 'out', 3).find((item) => item.id === 'b')?.startTime).toBe(4);

    const rippled = rippleTrimTo(sequence, tracks, 'a', 'out', 6);
    expect(rippled.find((item) => item.id === 'a')).toMatchObject({ endTime: 6, outPoint: 6 });
    expect(rippled.find((item) => item.id === 'b')).toMatchObject({ startTime: 6, endTime: 10 });

    const head = rippleTrimTo(sequence, tracks, 'b', 'in', 1);
    expect(head.find((item) => item.id === 'b')).toMatchObject({ startTime: 4, endTime: 7, inPoint: 1, outPoint: 4 });
    expect(head.find((item) => item.id === 'c')).toMatchObject({ startTime: 7, endTime: 11 });

    const rolled = rollTo(sequence, tracks, 'a', 'out', 5);
    expect(rolled.find((item) => item.id === 'a')).toMatchObject({ endTime: 5, outPoint: 5 });
    expect(rolled.find((item) => item.id === 'b')).toMatchObject({ startTime: 5, endTime: 8, inPoint: 1, outPoint: 4 });

    expect(slipTo(sequence, tracks, 'c', 3).find((item) => item.id === 'c')).toMatchObject({
      startTime: 8,
      endTime: 12,
      inPoint: 3,
      outPoint: 7,
    });

    const slid = slideTo(sequence, tracks, 'b', 6);
    expect(slid.find((item) => item.id === 'a')).toMatchObject({ endTime: 6, outPoint: 6 });
    expect(slid.find((item) => item.id === 'b')).toMatchObject({ startTime: 6, endTime: 10, inPoint: 0, outPoint: 4 });
    expect(slid.find((item) => item.id === 'c')).toMatchObject({ startTime: 10, endTime: 12, inPoint: 3, outPoint: 5 });
  });

  it('snaps when enabled and moves a linked partner in time only', () => {
    const points = collectSnapPoints(sequence, [{ id: 'm', time: 3, label: '', color: 'red' }], 1, 9, 7, ['a']);
    expect(snapTime(3.05, points, 0.1, true)).toBe(3);
    expect(snapTime(3.05, points, 0.1, false)).toBe(3.05);

    const linked = sequence.map((item) => (item.id === 'a' ? { ...item, linkId: 'pair' } : item));
    const moved = moveClipTo(linked, tracks, 'a', 'v2', 2);
    expect(moved.find((item) => item.id === 'a')).toMatchObject({ trackId: 'v2', startTime: 2, endTime: 6 });
    expect(moved.find((item) => item.id === 'sound')).toMatchObject({ trackId: 'a1', startTime: 2, endTime: 6 });
    const unlinked = moveClipTo(unlinkClip(linked, 'a'), tracks, 'a', 'v2', 2);
    expect(unlinked.find((item) => item.id === 'sound')?.startTime).toBe(0);
  });

  it('ripples the clip under the playhead back to the playhead', () => {
    const next = rippleTrimToPlayhead(sequence, tracks, 2, 'next');
    expect(next.find((item) => item.id === 'a')?.endTime).toBe(2);
    expect(next.find((item) => item.id === 'b')?.startTime).toBe(2);
    expect(next.find((item) => item.id === 'upper')?.endTime).toBe(2);
  });

  it('does not edit a locked track', () => {
    const locked = tracks.map((track) => (track.id === 'v1' ? { ...track, locked: true } : track));
    expect(rippleDelete(sequence, locked, ['b'])).toEqual(sequence);
    expect(trimEdgeTo(sequence, locked, 'a', 'out', 2)).toEqual(sequence);
  });

  it('links two clips and round-trips keyframes through an older project shape', () => {
    const linked = linkPair(sequence, 'a', 'sound', 'sync');
    expect(linked.find((item) => item.id === 'a')?.linkId).toBe('sync');
    expect(unlinkClip(linked, 'sound').every((item) => item.linkId !== 'sync')).toBe(true);

    const legacy = createDefaultVideoEdits();
    legacy.clips = [clip({ id: 'old', trackId: 'v1' })];
    const project = createProject({
      mode: 'video',
      projectPath: null,
      savedAt: '2026-10-19T00:00:00.000Z',
      photo: { edits: createDefaultPhotoEdits(), mediaPath: null, mediaName: null },
      video: { edits: legacy, mediaPath: null, mediaName: null, timelineZoom: 1 },
    });
    const parsed = parseProject(serializeProject(project));
    expect(parsed.video.edits.clips[0]).toEqual(legacy.clips[0]);
    expect(parsed.video.edits.snapping).toBe(true);
    expect(parsed.video.edits.programKeyframes).toEqual([]);

    const animated = normalizeVideoEdits({
      snapping: false,
      programKeyframes: [{ id: 'p', time: 1, property: 'opacity', value: 0.5, easing: 'easeOut' }],
      clips: [{
        id: 'old',
        src: '/a.mp4',
        trackId: 'v1',
        startTime: 0,
        endTime: 2,
        inPoint: 0,
        outPoint: 2,
        linkId: 'sync',
        keyframes: [
          { id: 'k', time: 0.5, property: 'scale', value: 1.5, easing: 'easeIn' },
          { id: 'bad', time: 0, property: 'effect', value: 1, easing: 'linear' },
        ],
      }],
    });
    expect(animated.snapping).toBe(false);
    expect(animated.programKeyframes[0]).toMatchObject({ value: 0.5, easing: 'easeOut' });
    expect(animated.clips[0]?.linkId).toBe('sync');
    expect(animated.clips[0]?.keyframes).toEqual([
      { id: 'k', time: 0.5, property: 'scale', value: 1.5, easing: 'easeIn' },
    ]);

    const bare = normalizeVideoEdits({ clips: [{ id: 'old', src: '/a.mp4', trackId: 'v1', startTime: 0, endTime: 1, inPoint: 0, outPoint: 1 }] });
    expect(bare.clips[0]).not.toHaveProperty('keyframes');
    expect(bare.clips[0]).not.toHaveProperty('linkId');
    expect(bare.snapping).toBe(true);
  });

  it('inserts a linked picture and sound clip after the last video edit', () => {
    let seq = 0;
    const existing = clip({ id: 'v-old', trackId: 'v1', endTime: 3, outPoint: 3 });
    const placed = insertProgramClip({
      clips: [existing],
      tracks,
      src: '/media/open.mp4',
      inPoint: 1,
      outPoint: 3,
      createId: (prefix) => `${prefix}-${++seq}`,
    });
    expect(trackEnd([existing], 'v1')).toBe(3);
    expect(placed).toHaveLength(3);
    expect(placed?.[1]).toMatchObject({ trackId: 'v1', startTime: 3, endTime: 5, inPoint: 1, outPoint: 3, src: '/media/open.mp4' });
    expect(placed?.[2]).toMatchObject({ trackId: 'a1', startTime: 3, endTime: 5 });
    expect(placed?.[1]?.linkId).toBe(placed?.[2]?.linkId);

    expect(insertProgramClip({
      clips: [],
      tracks,
      src: '/media/open.mp4',
      inPoint: 0,
      outPoint: 0.01,
      createId: (prefix) => prefix,
    })).toBeNull();

    const locked = tracks.map((track) => (track.id === 'v1' ? { ...track, locked: true } : track));
    expect(insertProgramClip({
      clips: [],
      tracks: locked,
      src: '/media/open.mp4',
      inPoint: 0,
      outPoint: 2,
      createId: (prefix) => prefix,
    })).toBeNull();
  });
});
