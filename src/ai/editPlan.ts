/**
 * Timeline cuts driven by silence, fillers, or a transcript.
 * Clip math stays in the existing timeline helpers so linked audio follows the picture.
 */
import type { TimelineClip, TimelineMarker, TimelineTrack } from '../types';
import type { VideoEditSnapshot } from '../utils/editSnapshots';
import { razorAtTime, rippleDelete } from '../utils/video/timelineEdit';

export interface TimeRange {
  start: number;
  end: number;
}

export interface TranscriptWord {
  id: string;
  text: string;
  start: number;
  end: number;
}

export function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter((range) => range.end - range.start >= 0.02)
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end + 0.02) merged.push({ ...range });
    else previous.end = Math.max(previous.end, range.end);
  }
  return merged;
}

export function ensureEditableClips(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  duration: number,
  src: string,
  newId: () => string,
): TimelineClip[] {
  if (clips.length > 0 || !(duration > 0.05) || src.length === 0) return clips.slice();
  const video = tracks.find((track) => track.type === 'video' && !track.locked);
  const audio = tracks.find((track) => track.type === 'audio' && !track.locked);
  if (!video && !audio) return clips.slice();
  const link = video && audio ? newId().replace(/^clip_/, 'link_') : null;
  const next: TimelineClip[] = [];
  if (video) {
    next.push({
      id: newId(),
      src,
      trackId: video.id,
      startTime: 0,
      endTime: duration,
      inPoint: 0,
      outPoint: duration,
      linkId: link,
    });
  }
  if (audio) {
    next.push({
      id: newId(),
      src,
      trackId: audio.id,
      startTime: 0,
      endTime: duration,
      inPoint: 0,
      outPoint: duration,
      linkId: link,
    });
  }
  return next;
}

export function removeSequenceRanges(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  ranges: readonly TimeRange[],
  newId: () => string,
): TimelineClip[] {
  let next = clips.slice();
  const ordered = mergeRanges(ranges).sort((a, b) => b.start - a.start);
  for (const range of ordered) {
    next = razorAtTime(next, tracks, range.end, newId);
    next = razorAtTime(next, tracks, range.start, newId);
    const victims = next.filter((clip) =>
      clip.startTime >= range.start - 0.02 && clip.endTime <= range.end + 0.02,
    );
    if (victims.length > 0) next = rippleDelete(next, tracks, victims.map((clip) => clip.id));
  }
  return next;
}

export function shiftMarkers(markers: readonly TimelineMarker[], ranges: readonly TimeRange[]): TimelineMarker[] {
  const merged = mergeRanges(ranges);
  const next: TimelineMarker[] = [];
  for (const marker of markers) {
    if (merged.some((range) => marker.time >= range.start - 1e-4 && marker.time < range.end - 1e-4)) continue;
    let shift = 0;
    for (const range of merged) {
      if (range.end <= marker.time + 1e-4) shift += range.end - range.start;
    }
    next.push({ ...marker, time: Math.max(0, marker.time - shift) });
  }
  return next.sort((a, b) => a.time - b.time);
}

export function shiftWords(words: readonly TranscriptWord[], ranges: readonly TimeRange[]): TranscriptWord[] {
  const merged = mergeRanges(ranges);
  const next: TranscriptWord[] = [];
  for (const word of words) {
    const covered = merged.some((range) => word.start < range.end - 0.02 && word.end > range.start + 0.02);
    if (covered) continue;
    let shift = 0;
    for (const range of merged) {
      if (range.end <= word.start + 1e-4) shift += range.end - range.start;
    }
    next.push({ ...word, start: Math.max(0, word.start - shift), end: Math.max(0, word.end - shift) });
  }
  return next;
}

export function planRemoval(
  snap: VideoEditSnapshot,
  ranges: readonly TimeRange[],
  source: { src: string; duration: number },
  newId: () => string,
): VideoEditSnapshot {
  const seeded = ensureEditableClips(snap.clips, snap.tracks, source.duration, source.src, newId);
  const clips = removeSequenceRanges(seeded, snap.tracks, ranges, newId);
  return {
    ...snap,
    clips,
    markers: shiftMarkers(snap.markers, ranges),
  };
}
