import type { TimelineClip, TimelineTrack, TrackType } from '../../types';
import { mediaBaseName } from './paths';
import { quantizeTime, resolveRate } from './timecode';

export interface InterchangeClip {
  id: string;
  name: string;
  path: string;
  trackName: string;
  trackType: TrackType;
  /** Timeline in, seconds. */
  start: number;
  /** Timeline out, seconds. */
  end: number;
  /** Source in, seconds. */
  inPoint: number;
  /** Source out, seconds. */
  outPoint: number;
}

export interface InterchangeSequence {
  name: string;
  frameRate: number;
  dropFrame: boolean;
  width: number;
  height: number;
  clips: InterchangeClip[];
}

export interface SequenceOptions {
  name?: string;
  frameRate?: number;
  dropFrame?: boolean;
  width?: number;
  height?: number;
}

export function createSequence(options: SequenceOptions = {}): InterchangeSequence {
  const frameRate = resolveRate(options.frameRate ?? 24).label;
  return {
    name: options.name?.trim() || 'Sequence',
    frameRate,
    dropFrame: Boolean(options.dropFrame),
    width: positive(options.width, 1920),
    height: positive(options.height, 1080),
    clips: [],
  };
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

/** Clips in time order, picture before sound. Keyframes stay on the timeline and are not copied. */
export function sequenceFromTimeline(
  tracks: readonly TimelineTrack[],
  clips: readonly TimelineClip[],
  options: SequenceOptions = {},
): InterchangeSequence {
  const sequence = createSequence(options);
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  sequence.clips = clips.flatMap((clip) => {
    const track = trackById.get(clip.trackId);
    if (!track) return [];
    const start = Math.max(0, clip.startTime);
    const end = Math.max(start, clip.endTime);
    const inPoint = Math.max(0, clip.inPoint);
    const outPoint = Math.max(inPoint, clip.outPoint);
    return [{
      id: clip.id,
      name: mediaBaseName(clip.src),
      path: clip.src,
      trackName: track.name,
      trackType: track.type,
      start,
      end,
      inPoint,
      outPoint: outPoint > inPoint ? outPoint : inPoint + (end - start),
    }];
  });
  sequence.clips = sortedClips(sequence.clips);
  return sequence;
}

export function sortedClips(clips: readonly InterchangeClip[]): InterchangeClip[] {
  return [...clips].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.trackType !== b.trackType) return a.trackType === 'video' ? -1 : 1;
    const byName = a.trackName.localeCompare(b.trackName, undefined, { numeric: true });
    if (byName !== 0) return byName;
    return a.name.localeCompare(b.name) || a.path.localeCompare(b.path);
  });
}

function trackIdFor(name: string, type: TrackType, existing: readonly TimelineTrack[]): string {
  const match = /^[va](\d+)$/i.exec(name.trim());
  if (match) {
    const preferred = `${type === 'video' ? 'v' : 'a'}${match[1]}`;
    if (!existing.some((track) => track.id === preferred)) return preferred;
  }
  const prefix = type === 'video' ? 'v' : 'a';
  let index = existing.filter((track) => track.type === type).length + 1;
  let id = `${prefix}${index}`;
  while (existing.some((track) => track.id === id)) {
    index += 1;
    id = `${prefix}${index}`;
  }
  return id;
}

/** Rebuild timeline tracks and clips. Animated keys are left empty so interchange stays independent of the keyframe system. */
export function timelineFromSequence(sequence: InterchangeSequence): { tracks: TimelineTrack[]; clips: TimelineClip[] } {
  const tracks: TimelineTrack[] = [];
  const trackIds = new Map<string, string>();
  const usedClipIds = new Set<string>();
  const clips: TimelineClip[] = [];
  sortedClips(sequence.clips).forEach((clip, index) => {
    const trackName = clip.trackName.trim() || (clip.trackType === 'video' ? 'V1' : 'A1');
    const key = `${clip.trackType}:${trackName}`;
    let trackId = trackIds.get(key);
    if (!trackId) {
      trackId = trackIdFor(trackName, clip.trackType, tracks);
      trackIds.set(key, trackId);
      tracks.push({ id: trackId, type: clip.trackType, name: trackName, muted: false, locked: false });
    }
    const start = Math.max(0, clip.start);
    const end = clip.end > start ? clip.end : start;
    const inPoint = Math.max(0, clip.inPoint);
    const outPoint = clip.outPoint > inPoint ? clip.outPoint : inPoint + (end - start);
    let id = clip.id.trim() || `clip-${index + 1}`;
    if (usedClipIds.has(id)) id = `${id}-${index + 1}`;
    usedClipIds.add(id);
    clips.push({
      id,
      src: clip.path || clip.name,
      trackId,
      startTime: start,
      endTime: end,
      inPoint,
      outPoint,
      linkId: null,
      keyframes: [],
    });
  });
  tracks.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'video' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
  return { tracks, clips };
}

export function frameTolerance(frameRate: number): number {
  return framesDuration(frameRate) + 1e-6;
}

function framesDuration(frameRate: number): number {
  const rate = resolveRate(frameRate);
  return rate.num / rate.den;
}

export function quantizeClip(clip: InterchangeClip, frameRate: number): InterchangeClip {
  const start = quantizeTime(clip.start, frameRate);
  let end = quantizeTime(clip.end, frameRate);
  if (end <= start) end = quantizeTime(start, frameRate) + framesDuration(frameRate);
  const inPoint = quantizeTime(clip.inPoint, frameRate);
  let outPoint = quantizeTime(clip.outPoint, frameRate);
  if (outPoint <= inPoint) outPoint = inPoint + (end - start);
  return { ...clip, start, end, inPoint, outPoint };
}
