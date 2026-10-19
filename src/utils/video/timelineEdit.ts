import type { TimelineClip, TimelineMarker, TimelineTrack } from '../../types';
import { retimedKeyframes } from './keyframes';

export const MIN_CLIP_DURATION = 0.05;
const JOIN_GAP = 0.08;

let idSequence = 0;

export function createTimelineId(prefix: string): string {
  idSequence += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSequence.toString(36)}`;
}

export function clipDuration(clip: TimelineClip): number {
  return clip.endTime - clip.startTime;
}

export function displayTrackOrder(tracks: readonly TimelineTrack[]): TimelineTrack[] {
  const video = tracks.filter((track) => track.type === 'video');
  const audio = tracks.filter((track) => track.type === 'audio');
  return [...video].reverse().concat(audio);
}

function trackOf(tracks: readonly TimelineTrack[], trackId: string): TimelineTrack | undefined {
  return tracks.find((track) => track.id === trackId);
}

function clipOf(clips: readonly TimelineClip[], clipId: string): TimelineClip | undefined {
  return clips.find((clip) => clip.id === clipId);
}

export function isTrackLocked(tracks: readonly TimelineTrack[], trackId: string): boolean {
  return trackOf(tracks, trackId)?.locked ?? false;
}

export function linkedGroup(clips: readonly TimelineClip[], clipId: string): TimelineClip[] {
  const clip = clipOf(clips, clipId);
  if (!clip) return [];
  if (!clip.linkId) return [clip];
  const group = clips.filter((item) => item.linkId === clip.linkId);
  return group.length > 0 ? group : [clip];
}

function groupLocked(clips: readonly TimelineClip[], tracks: readonly TimelineTrack[], clipId: string): boolean {
  return linkedGroup(clips, clipId).some((clip) => isTrackLocked(tracks, clip.trackId));
}

function shiftClip(clip: TimelineClip, delta: number): TimelineClip {
  if (Math.abs(delta) < 1e-6) return clip;
  return { ...clip, startTime: clip.startTime + delta, endTime: clip.endTime + delta };
}

function clipsOnTrack(clips: readonly TimelineClip[], trackId: string): TimelineClip[] {
  return clips.filter((clip) => clip.trackId === trackId);
}

function nextJoined(clips: readonly TimelineClip[], clip: TimelineClip): TimelineClip | null {
  const follower = clipsOnTrack(clips, clip.trackId)
    .filter((item) => item.id !== clip.id && item.startTime >= clip.endTime - JOIN_GAP)
    .sort((a, b) => a.startTime - b.startTime)[0];
  if (!follower || follower.startTime - clip.endTime > JOIN_GAP) return null;
  return follower;
}

function previousJoined(clips: readonly TimelineClip[], clip: TimelineClip): TimelineClip | null {
  const previous = clipsOnTrack(clips, clip.trackId)
    .filter((item) => item.id !== clip.id && item.endTime <= clip.startTime + JOIN_GAP)
    .sort((a, b) => b.endTime - a.endTime)[0];
  if (!previous || clip.startTime - previous.endTime > JOIN_GAP) return null;
  return previous;
}

function shiftFollowers(
  clips: readonly TimelineClip[],
  trackId: string,
  atOrAfter: number,
  delta: number,
  exclude: ReadonlySet<string>,
): TimelineClip[] {
  if (Math.abs(delta) < 1e-6) return clips.slice();
  return clips.map((clip) => {
    if (clip.trackId !== trackId || exclude.has(clip.id)) return clip;
    if (clip.startTime + 1e-4 < atOrAfter) return clip;
    return shiftClip(clip, delta);
  });
}

function coveredBefore(removed: readonly TimelineClip[], before: number): number {
  const intervals = removed
    .filter((clip) => clip.startTime < before - 1e-4)
    .map((clip) => [clip.startTime, Math.min(clip.endTime, before)] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [start, stop] of intervals) {
    const from = Math.max(start, end);
    if (stop > from) total += stop - from;
    end = Math.max(end, stop);
  }
  return total;
}

export function snapTime(time: number, points: readonly number[], threshold: number, enabled: boolean): number {
  if (!enabled || threshold <= 0) return time;
  let best = time;
  let distance = threshold;
  for (const point of points) {
    const gap = Math.abs(point - time);
    if (gap < distance || (gap === distance && point < best)) {
      distance = gap;
      best = point;
    }
  }
  return best;
}

/** Snap a moved clip by either its head or its tail, whichever lands closer. */
export function snapSpan(
  start: number,
  duration: number,
  points: readonly number[],
  threshold: number,
  enabled: boolean,
): number {
  if (!enabled) return start;
  const head = snapTime(start, points, threshold, true);
  const tail = snapTime(start + duration, points, threshold, true);
  const headGap = Math.abs(head - start);
  const tailGap = Math.abs(tail - (start + duration));
  if (headGap === 0 && tailGap === 0) return start;
  if (tailGap < headGap) return tail - duration;
  return head;
}

export function collectSnapPoints(
  clips: readonly TimelineClip[],
  markers: readonly TimelineMarker[],
  trimStart: number,
  trimEnd: number,
  playhead: number,
  excludeIds: readonly string[],
): number[] {
  const exclude = new Set(excludeIds);
  const points = [0, playhead, trimStart, trimEnd];
  for (const marker of markers) points.push(marker.time);
  for (const clip of clips) {
    if (exclude.has(clip.id)) continue;
    points.push(clip.startTime, clip.endTime);
  }
  return points;
}

export function splitClip(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  clipId: string,
  atTime: number,
  newId: () => string = createTimelineId.bind(null, 'clip'),
): TimelineClip[] {
  const seed = clipOf(clips, clipId);
  if (!seed) return clips.slice();
  const targets = linkedGroup(clips, clipId).filter((clip) => {
    if (isTrackLocked(tracks, clip.trackId)) return false;
    return atTime > clip.startTime + 1e-4 && atTime < clip.endTime - 1e-4;
  });
  if (targets.length === 0) return clips.slice();
  const targetIds = new Set(targets.map((clip) => clip.id));
  const rightLinks = new Map<string, string>();
  const next: TimelineClip[] = [];
  for (const clip of clips) {
    if (!targetIds.has(clip.id)) {
      next.push(clip);
      continue;
    }
    const offset = atTime - clip.startTime;
    const rightLink = clip.linkId
      ? rightLinks.get(clip.linkId) ?? (() => {
          const id = newId().replace(/^clip_/, 'link_');
          rightLinks.set(clip.linkId as string, id);
          return id;
        })()
      : clip.linkId;
    const left: TimelineClip = {
      ...clip,
      endTime: atTime,
      outPoint: clip.inPoint + offset,
      keyframes: clip.keyframes?.filter((keyframe) => keyframe.time < offset - 1e-4),
    };
    const right: TimelineClip = {
      ...clip,
      id: newId(),
      startTime: atTime,
      inPoint: clip.inPoint + offset,
      linkId: rightLink,
      keyframes: clip.keyframes
        ?.filter((keyframe) => keyframe.time >= offset - 1e-4)
        .map((keyframe) => ({ ...keyframe, id: newId(), time: keyframe.time - offset })),
    };
    next.push(left, right);
  }
  return next;
}

export function razorAtTime(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  atTime: number,
  newId: () => string = () => createTimelineId('clip'),
): TimelineClip[] {
  const hitting = clips.filter(
    (clip) =>
      !isTrackLocked(tracks, clip.trackId) &&
      atTime > clip.startTime + 1e-4 &&
      atTime < clip.endTime - 1e-4,
  );
  let next = clips.slice();
  const seenLinks = new Set<string>();
  for (const clip of hitting) {
    if (clip.linkId && seenLinks.has(clip.linkId)) continue;
    if (clip.linkId) seenLinks.add(clip.linkId);
    if (!next.some((item) => item.id === clip.id)) continue;
    next = splitClip(next, tracks, clip.id, atTime, newId);
  }
  return next;
}

export function liftDelete(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  clipIds: readonly string[],
): TimelineClip[] {
  const remove = new Set<string>();
  for (const clipId of clipIds) {
    if (groupLocked(clips, tracks, clipId)) continue;
    for (const clip of linkedGroup(clips, clipId)) remove.add(clip.id);
  }
  if (remove.size === 0) return clips.slice();
  return clips.filter((clip) => !remove.has(clip.id));
}

export function rippleDelete(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  clipIds: readonly string[],
): TimelineClip[] {
  const remove = new Set<string>();
  for (const clipId of clipIds) {
    if (groupLocked(clips, tracks, clipId)) continue;
    for (const clip of linkedGroup(clips, clipId)) remove.add(clip.id);
  }
  if (remove.size === 0) return clips.slice();
  const removed = clips.filter((clip) => remove.has(clip.id));
  return clips
    .filter((clip) => !remove.has(clip.id))
    .map((clip) => {
      const shift = coveredBefore(
        removed.filter((item) => item.trackId === clip.trackId),
        clip.startTime,
      );
      return shiftClip(clip, -shift);
    });
}

export function moveClipTo(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  clipId: string,
  newTrackId: string,
  newStart: number,
): TimelineClip[] {
  const clip = clipOf(clips, clipId);
  if (!clip || groupLocked(clips, tracks, clipId)) return clips.slice();
  const target = trackOf(tracks, newTrackId);
  const trackId = target && !target.locked && target.type === trackOf(tracks, clip.trackId)?.type ? target.id : clip.trackId;
  const start = Math.max(0, newStart);
  const delta = start - clip.startTime;
  return clips.map((item) => {
    if (item.id === clip.id) {
      const moved = shiftClip(item, delta);
      return moved.trackId === trackId ? moved : { ...moved, trackId };
    }
    if (clip.linkId && item.linkId === clip.linkId) return shiftClip(item, delta);
    return item;
  });
}

function applyTiming(
  clip: TimelineClip,
  timing: { startTime: number; endTime: number; inPoint: number; outPoint: number },
  keyShift: number,
): TimelineClip {
  const duration = timing.endTime - timing.startTime;
  return {
    ...clip,
    ...timing,
    keyframes: retimedKeyframes(clip.keyframes, keyShift, duration),
  };
}

export function trimEdgeTo(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  clipId: string,
  edge: 'in' | 'out',
  time: number,
): TimelineClip[] {
  const clip = clipOf(clips, clipId);
  if (!clip || groupLocked(clips, tracks, clipId)) return clips.slice();
  const delta = edge === 'out' ? time - clip.endTime : time - clip.startTime;
  if (Math.abs(delta) < 1e-6) return clips.slice();
  return clips.map((item) => {
    const linked = item.id === clip.id || (clip.linkId !== undefined && clip.linkId !== null && item.linkId === clip.linkId);
    if (!linked) return item;
    if (edge === 'out') {
      const endTime = item.endTime + delta;
      if (endTime - item.startTime < MIN_CLIP_DURATION) return item;
      return applyTiming(item, {
        startTime: item.startTime,
        endTime,
        inPoint: item.inPoint,
        outPoint: item.inPoint + (endTime - item.startTime),
      }, 0);
    }
    const startTime = Math.max(0, item.startTime + delta);
    const applied = startTime - item.startTime;
    if (item.endTime - startTime < MIN_CLIP_DURATION) return item;
    if (item.inPoint + applied < 0) return item;
    return applyTiming(item, {
      startTime,
      endTime: item.endTime,
      inPoint: item.inPoint + applied,
      outPoint: item.outPoint,
    }, applied);
  });
}

export function rippleTrimTo(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  clipId: string,
  edge: 'in' | 'out',
  value: number,
): TimelineClip[] {
  const clip = clipOf(clips, clipId);
  if (!clip || groupLocked(clips, tracks, clipId)) return clips.slice();
  const group = linkedGroup(clips, clipId);
  if (edge === 'out') {
    const delta = value - clip.endTime;
    if (Math.abs(delta) < 1e-6) return clips.slice();
    if (group.some((item) => item.endTime + delta - item.startTime < MIN_CLIP_DURATION)) return clips.slice();
    let next = clips.map((item) => {
      if (!group.some((member) => member.id === item.id)) return item;
      const endTime = item.endTime + delta;
      return applyTiming(item, {
        startTime: item.startTime,
        endTime,
        inPoint: item.inPoint,
        outPoint: item.inPoint + (endTime - item.startTime),
      }, 0);
    });
    const exclude = new Set(group.map((item) => item.id));
    for (const member of group) {
      next = shiftFollowers(next, member.trackId, member.endTime, delta, exclude);
    }
    return next;
  }
  const delta = value - clip.inPoint;
  if (Math.abs(delta) < 1e-6) return clips.slice();
  if (group.some((item) => item.inPoint + delta < -1e-6)) return clips.slice();
  if (group.some((item) => item.endTime - delta - item.startTime < MIN_CLIP_DURATION)) return clips.slice();
  let next = clips.map((item) => {
    if (!group.some((member) => member.id === item.id)) return item;
    return applyTiming(item, {
      startTime: item.startTime,
      endTime: item.endTime - delta,
      inPoint: item.inPoint + delta,
      outPoint: item.outPoint,
    }, delta);
  });
  const exclude = new Set(group.map((item) => item.id));
  for (const member of group) {
    next = shiftFollowers(next, member.trackId, member.endTime, -delta, exclude);
  }
  return next;
}

export function rollTo(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  clipId: string,
  edge: 'in' | 'out',
  cutTime: number,
): TimelineClip[] {
  const clip = clipOf(clips, clipId);
  if (!clip || groupLocked(clips, tracks, clipId)) return clips.slice();
  const primaryNeighbor = edge === 'out' ? nextJoined(clips, clip) : previousJoined(clips, clip);
  if (!primaryNeighbor || isTrackLocked(tracks, primaryNeighbor.trackId)) return clips.slice();
  const currentCut = edge === 'out' ? clip.endTime : clip.startTime;
  const delta = cutTime - currentCut;
  if (Math.abs(delta) < 1e-6) return clips.slice();

  const replacements = new Map<string, TimelineClip>();
  const pairs: Array<[TimelineClip, TimelineClip]> = [[clip, primaryNeighbor]];
  for (const member of linkedGroup(clips, clipId)) {
    if (member.id === clip.id) continue;
    const neighbor = edge === 'out' ? nextJoined(clips, member) : previousJoined(clips, member);
    if (neighbor && !isTrackLocked(tracks, neighbor.trackId)) pairs.push([member, neighbor]);
  }
  for (const [member, neighbor] of pairs) {
    const left = edge === 'out' ? member : neighbor;
    const right = edge === 'out' ? neighbor : member;
    if (left.endTime + delta - left.startTime < MIN_CLIP_DURATION) return clips.slice();
    if (right.endTime - (right.startTime + delta) < MIN_CLIP_DURATION) return clips.slice();
    if (right.inPoint + delta < -1e-6) return clips.slice();
    const leftEnd = left.endTime + delta;
    replacements.set(left.id, applyTiming(left, {
      startTime: left.startTime,
      endTime: leftEnd,
      inPoint: left.inPoint,
      outPoint: left.inPoint + (leftEnd - left.startTime),
    }, 0));
    replacements.set(right.id, applyTiming(right, {
      startTime: right.startTime + delta,
      endTime: right.endTime,
      inPoint: right.inPoint + delta,
      outPoint: right.outPoint,
    }, delta));
  }
  return clips.map((item) => replacements.get(item.id) ?? item);
}

export function slipTo(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  clipId: string,
  newInPoint: number,
): TimelineClip[] {
  const clip = clipOf(clips, clipId);
  if (!clip || groupLocked(clips, tracks, clipId)) return clips.slice();
  const delta = newInPoint - clip.inPoint;
  if (Math.abs(delta) < 1e-6) return clips.slice();
  const group = linkedGroup(clips, clipId);
  if (group.some((item) => item.inPoint + delta < -1e-6)) return clips.slice();
  return clips.map((item) => {
    if (!group.some((member) => member.id === item.id)) return item;
    return {
      ...item,
      inPoint: item.inPoint + delta,
      outPoint: item.outPoint + delta,
    };
  });
}

export function slideTo(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  clipId: string,
  newStart: number,
): TimelineClip[] {
  const clip = clipOf(clips, clipId);
  if (!clip || groupLocked(clips, tracks, clipId)) return clips.slice();
  const delta = Math.max(0, newStart) - clip.startTime;
  if (Math.abs(delta) < 1e-6) return clips.slice();
  const group = linkedGroup(clips, clipId);
  let next = clips.slice();
  for (const member of group) {
    const previous = previousJoined(next, member);
    const following = nextJoined(next, member);
    if (previous && previous.endTime + delta - previous.startTime < MIN_CLIP_DURATION) return clips.slice();
    if (following && following.inPoint + delta < -1e-6) return clips.slice();
    if (following && following.endTime - (following.startTime + delta) < MIN_CLIP_DURATION) return clips.slice();
    next = next.map((item) => {
      if (item.id === member.id) return shiftClip(item, delta);
      if (previous && item.id === previous.id) {
        const endTime = item.endTime + delta;
        return applyTiming(item, {
          startTime: item.startTime,
          endTime,
          inPoint: item.inPoint,
          outPoint: item.inPoint + (endTime - item.startTime),
        }, 0);
      }
      if (following && item.id === following.id) {
        const startTime = item.startTime + delta;
        return applyTiming(item, {
          startTime,
          endTime: item.endTime,
          inPoint: item.inPoint + delta,
          outPoint: item.outPoint,
        }, delta);
      }
      return item;
    });
  }
  return next;
}

/** End of the last clip on a track, or 0 when the track is empty. */
export function trackEnd(clips: readonly TimelineClip[], trackId: string): number {
  let end = 0;
  for (const clip of clips) {
    if (clip.trackId === trackId && clip.endTime > end) end = clip.endTime;
  }
  return end;
}

export interface InsertProgramClipInput {
  clips: readonly TimelineClip[];
  tracks: readonly TimelineTrack[];
  src: string;
  inPoint: number;
  outPoint: number;
  videoTrackId?: string;
  audioTrackId?: string;
  createId: (prefix: string) => string;
}

/**
 * Append the open program source to the primary video track and, when that
 * audio track is free, a linked sound clip of the same range.
 * Returns null when the range is too short or the video track is locked.
 */
export function insertProgramClip(input: InsertProgramClipInput): TimelineClip[] | null {
  const span = input.outPoint - input.inPoint;
  if (!input.src || !Number.isFinite(span) || span < MIN_CLIP_DURATION) return null;
  const videoTrackId = input.videoTrackId ?? 'v1';
  const audioTrackId = input.audioTrackId ?? 'a1';
  const videoTrack = input.tracks.find((track) => track.id === videoTrackId && track.type === 'video');
  if (!videoTrack || videoTrack.locked) return null;
  const start = trackEnd(input.clips, videoTrackId);
  const linkId = input.createId('link');
  const video: TimelineClip = {
    id: input.createId('clip'),
    src: input.src,
    trackId: videoTrackId,
    startTime: start,
    endTime: start + span,
    inPoint: input.inPoint,
    outPoint: input.outPoint,
    linkId,
    keyframes: [],
  };
  const next = [...input.clips, video];
  const audioTrack = input.tracks.find((track) => track.id === audioTrackId && track.type === 'audio');
  if (audioTrack && !audioTrack.locked) {
    next.push({
      id: input.createId('clip'),
      src: input.src,
      trackId: audioTrackId,
      startTime: start,
      endTime: start + span,
      inPoint: input.inPoint,
      outPoint: input.outPoint,
      linkId,
      keyframes: [],
    });
  }
  return next;
}

export function linkPair(clips: readonly TimelineClip[], idA: string, idB: string, linkId: string): TimelineClip[] {
  if (idA === idB) return clips.slice();
  const a = clipOf(clips, idA);
  const b = clipOf(clips, idB);
  if (!a || !b) return clips.slice();
  return clips.map((clip) => (clip.id === idA || clip.id === idB ? { ...clip, linkId } : clip));
}

export function unlinkClip(clips: readonly TimelineClip[], clipId: string): TimelineClip[] {
  const clip = clipOf(clips, clipId);
  if (!clip?.linkId) return clips.slice();
  const linkId = clip.linkId;
  return clips.map((item) => (item.linkId === linkId ? { ...item, linkId: null } : item));
}

export function toggleLink(
  clips: readonly TimelineClip[],
  selectedId: string | null,
  playhead: number,
  tracks: readonly TimelineTrack[],
  linkId: string,
): TimelineClip[] {
  if (!selectedId) return clips.slice();
  const selected = clipOf(clips, selectedId);
  if (!selected) return clips.slice();
  if (selected.linkId) return unlinkClip(clips, selectedId);
  const partner = clipAtPlayhead(clips, tracks, playhead);
  if (!partner || partner.id === selected.id) return clips.slice();
  if (trackOf(tracks, partner.trackId)?.type === trackOf(tracks, selected.trackId)?.type) return clips.slice();
  return linkPair(clips, selected.id, partner.id, linkId);
}

export function rippleTrimToPlayhead(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  time: number,
  edge: 'previous' | 'next',
): TimelineClip[] {
  const hitting = clips.filter(
    (clip) => !isTrackLocked(tracks, clip.trackId) && time > clip.startTime + 1e-4 && time < clip.endTime - 1e-4,
  );
  let next = clips.slice();
  const seen = new Set<string>();
  for (const clip of hitting) {
    if (clip.linkId && seen.has(clip.linkId)) continue;
    if (!next.some((item) => item.id === clip.id)) continue;
    if (clip.linkId) seen.add(clip.linkId);
    if (edge === 'previous') {
      const amount = time - clip.startTime;
      const current = next.find((item) => item.id === clip.id);
      if (!current) continue;
      next = rippleTrimTo(next, tracks, clip.id, 'in', current.inPoint + amount);
    } else {
      next = rippleTrimTo(next, tracks, clip.id, 'out', time);
    }
  }
  return next;
}

export function editPoints(
  clips: readonly TimelineClip[],
  markers: readonly TimelineMarker[],
  trimStart: number,
  trimEnd: number,
): number[] {
  const points = new Set<number>([0, trimStart, trimEnd]);
  for (const marker of markers) points.add(marker.time);
  for (const clip of clips) {
    points.add(clip.startTime);
    points.add(clip.endTime);
  }
  return [...points].sort((a, b) => a - b);
}

export function neighborEdit(points: readonly number[], time: number, direction: -1 | 1): number | null {
  const epsilon = 0.001;
  if (direction < 0) {
    const previous = [...points].reverse().find((point) => point < time - epsilon);
    return previous ?? null;
  }
  return points.find((point) => point > time + epsilon) ?? null;
}

export function clipAtPlayhead(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  time: number,
): TimelineClip | null {
  for (const track of displayTrackOrder(tracks)) {
    const hit = clips.find((clip) => clip.trackId === track.id && time >= clip.startTime && time < clip.endTime);
    if (hit) return hit;
  }
  return null;
}

export function markClipRange(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  time: number,
): { start: number; end: number } | null {
  const clip = clipAtPlayhead(clips, tracks, time);
  if (!clip) return null;
  return { start: clip.startTime, end: clip.endTime };
}
