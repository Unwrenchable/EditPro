import type {
  AudioCategory,
  AudioTrackSettings,
  AutoReframeAspect,
  CropRect,
  LumetriColor,
  PhotoAdjustments,
  PhotoFilterName,
  ClipKeyframe,
  EaseCurve,
  KeyframeProperty,
  TimelineClip,
  TimelineMarker,
  TimelineTrack,
  VideoTransition,
} from '../types';
import { DEFAULT_BEZIER, normalizeBezierHandles, type BezierHandles } from '../../electron/export/easing';
import { DEFAULT_ADJUSTMENTS } from './imageFilters';
import { createDefaultCreativeState, normalizeCreativeState, type CreativeState } from './video/creative';
import { createMotionDocument, normalizeMotionDocument, type MotionDocument } from './video/motionGraphics';
import { normalizeMulticamSequence, type MulticamSequence } from './video/multicam';
import { DEFAULT_AUDIO, DEFAULT_LUMETRI } from './videoUtils';

const PHOTO_FILTERS: readonly PhotoFilterName[] = [
  'none',
  'grayscale',
  'sepia',
  'vivid',
  'cool',
  'warm',
  'fade',
  'dramatic',
  'matte',
];

const ASPECTS: readonly AutoReframeAspect[] = ['16:9', '9:16', '1:1', '4:5', '4:3', 'original'];
const TRANSITIONS: readonly VideoTransition[] = [
  'cut',
  'fade',
  'dissolve',
  'crossfade',
  'wipe',
  'slide',
  'zoom',
  'dip-to-black',
];
const AUDIO_CATEGORIES: readonly AudioCategory[] = ['dialogue', 'music', 'sfx', 'ambience'];
const MARKER_COLORS: readonly TimelineMarker['color'][] = ['red', 'yellow', 'green', 'blue'];
const EASINGS: readonly EaseCurve[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold', 'bezier'];
const KEYFRAME_PROPERTIES: readonly KeyframeProperty[] = [
  'positionX',
  'positionY',
  'scale',
  'rotation',
  'opacity',
  'effect',
];

/** Creative photo state. Transport and file handles live outside the snapshot. */
export interface PhotoEditSnapshot {
  adjustments: PhotoAdjustments;
  filter: PhotoFilterName;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  crop: CropRect | null;
}

/**
 * Editorial video state, including the timeline.
 * Playback position, play/pause, and duration are not part of the snapshot.
 */
export interface VideoEditSnapshot {
  trimStart: number;
  trimEnd: number;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
  lumetri: LumetriColor;
  audio: AudioTrackSettings;
  markers: TimelineMarker[];
  autoReframe: AutoReframeAspect;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  /** When true, edits snap to clip edges, the playhead, markers, and in/out. */
  snapping: boolean;
  /** Animation of the program picture, in absolute sequence seconds. */
  programKeyframes: ClipKeyframe[];
  transition: VideoTransition;
  creative: CreativeState;
  graphics: MotionDocument;
  multicam: MulticamSequence | null;
}

export interface MediaBinding {
  file: File | null;
  url: string | null;
  path: string | null;
  name: string | null;
  missing: boolean;
}

export function createDefaultPhotoEdits(): PhotoEditSnapshot {
  return {
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    filter: 'none',
    rotation: 0,
    flipH: false,
    flipV: false,
    crop: null,
  };
}

export function createDefaultTracks(): TimelineTrack[] {
  return [
    { id: 'v1', type: 'video', name: 'V1', muted: false, locked: false },
    { id: 'a1', type: 'audio', name: 'A1', muted: false, locked: false },
  ];
}

export function createDefaultVideoEdits(): VideoEditSnapshot {
  return {
    trimStart: 0,
    trimEnd: 0,
    playbackRate: 1,
    volume: 1,
    isMuted: false,
    lumetri: structuredClone(DEFAULT_LUMETRI),
    audio: { ...DEFAULT_AUDIO },
    markers: [],
    autoReframe: 'original',
    tracks: createDefaultTracks(),
    clips: [],
    snapping: true,
    programKeyframes: [],
    transition: 'cut',
    creative: createDefaultCreativeState(),
    graphics: createMotionDocument(),
    multicam: null,
  };
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function pickNumbers<T extends object>(defaults: T, input: unknown): T {
  const source = asRecord(input) ?? {};
  const out = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const def = defaults[key];
    const raw = source[key as string];
    if (typeof def === 'number') {
      (out as Record<string, unknown>)[key as string] = num(raw, def);
    } else if (typeof def === 'boolean') {
      (out as Record<string, unknown>)[key as string] = bool(raw, def as boolean);
    } else if (typeof def === 'string') {
      (out as Record<string, unknown>)[key as string] = str(raw, def as string);
    } else if (def && typeof def === 'object') {
      (out as Record<string, unknown>)[key as string] = pickNumbers(def, raw);
    }
  }
  return out;
}

function normalizeCrop(value: unknown): CropRect | null {
  const record = asRecord(value);
  if (!record) return null;
  const crop = {
    x: record.x,
    y: record.y,
    width: record.width,
    height: record.height,
  };
  if (![crop.x, crop.y, crop.width, crop.height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }
  return crop as CropRect;
}

export function normalizePhotoEdits(input: unknown): PhotoEditSnapshot {
  const defaults = createDefaultPhotoEdits();
  const record = asRecord(input);
  if (!record) return defaults;
  return {
    adjustments: pickNumbers(defaults.adjustments, record.adjustments),
    filter: oneOf(record.filter, PHOTO_FILTERS, 'none'),
    rotation: num(record.rotation, 0),
    flipH: bool(record.flipH, false),
    flipV: bool(record.flipV, false),
    crop: normalizeCrop(record.crop),
  };
}

function normalizeMarker(value: unknown): TimelineMarker | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  return {
    id: record.id,
    time: num(record.time, 0),
    label: str(record.label, ''),
    color: oneOf(record.color, MARKER_COLORS, 'yellow'),
  };
}

function normalizeTrack(value: unknown): TimelineTrack | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  const type = record.type === 'audio' ? 'audio' : record.type === 'video' ? 'video' : null;
  if (!type) return null;
  return {
    id: record.id,
    type,
    name: str(record.name, type === 'video' ? 'V' : 'A'),
    muted: bool(record.muted, false),
    locked: bool(record.locked, false),
  };
}

function readBezier(value: unknown): BezierHandles | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const x1 = num(record.x1, Number.NaN);
  const y1 = num(record.y1, Number.NaN);
  const x2 = num(record.x2, Number.NaN);
  const y2 = num(record.y2, Number.NaN);
  if (![x1, y1, x2, y2].every((axis) => Number.isFinite(axis))) return undefined;
  return normalizeBezierHandles({ x1, y1, x2, y2 });
}

function normalizeKeyframe(value: unknown): ClipKeyframe | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  const property = oneOf(record.property, KEYFRAME_PROPERTIES, 'opacity');
  if (record.property !== property) return null;
  const keyframe: ClipKeyframe = {
    id: record.id,
    time: Math.max(0, num(record.time, 0)),
    property,
    value: num(record.value, 0),
    easing: oneOf(record.easing, EASINGS, 'linear'),
  };
  if (property === 'effect') {
    const param = typeof record.effectParam === 'string' ? record.effectParam.trim() : '';
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(param)) return null;
    keyframe.effectParam = param;
  }
  const bezier = readBezier(record.bezier);
  if (bezier) keyframe.bezier = bezier;
  else if (keyframe.easing === 'bezier') keyframe.bezier = { ...DEFAULT_BEZIER };
  return keyframe;
}

function normalizeKeyframes(value: unknown): ClipKeyframe[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeKeyframe).filter((keyframe) => keyframe !== null);
}

function normalizeClip(value: unknown): TimelineClip | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  if (typeof record.src !== 'string' || typeof record.trackId !== 'string') return null;
  const clip: TimelineClip = {
    id: record.id,
    src: record.src,
    trackId: record.trackId,
    startTime: num(record.startTime, 0),
    endTime: num(record.endTime, 0),
    inPoint: num(record.inPoint, 0),
    outPoint: num(record.outPoint, 0),
  };
  // Older projects omit link and keyframe fields. Leave them absent so a
  // version-1 file round-trips without gaining new keys.
  if ('linkId' in record) {
    clip.linkId = typeof record.linkId === 'string' && record.linkId ? record.linkId : null;
  }
  if ('keyframes' in record) {
    clip.keyframes = normalizeKeyframes(record.keyframes);
  }
  return clip;
}

export function normalizeVideoEdits(input: unknown): VideoEditSnapshot {
  const defaults = createDefaultVideoEdits();
  const record = asRecord(input);
  if (!record) return defaults;
  const markers = Array.isArray(record.markers) ? record.markers.map(normalizeMarker).filter((m) => m !== null) : [];
  const tracks = Array.isArray(record.tracks) ? record.tracks.map(normalizeTrack).filter((t) => t !== null) : defaults.tracks;
  const clips = Array.isArray(record.clips) ? record.clips.map(normalizeClip).filter((c) => c !== null) : [];
  const audio = pickNumbers(defaults.audio, record.audio);
  audio.category = oneOf(asRecord(record.audio)?.category, AUDIO_CATEGORIES, defaults.audio.category);
  return {
    trimStart: num(record.trimStart, 0),
    trimEnd: num(record.trimEnd, 0),
    playbackRate: num(record.playbackRate, 1),
    volume: num(record.volume, 1),
    isMuted: bool(record.isMuted, false),
    lumetri: pickNumbers(defaults.lumetri, record.lumetri),
    audio,
    markers,
    autoReframe: oneOf(record.autoReframe, ASPECTS, 'original'),
    tracks,
    clips,
    snapping: bool(record.snapping, true),
    programKeyframes: normalizeKeyframes(record.programKeyframes),
    transition: oneOf(record.transition, TRANSITIONS, 'cut'),
    creative: normalizeCreativeState(record.creative),
    graphics: normalizeMotionDocument(record.graphics),
    multicam: normalizeMulticamSequence(record.multicam),
  };
}

export function normalizeTimelineZoom(value: unknown): number {
  const zoom = num(value, 1);
  return Math.min(8, Math.max(0.5, zoom));
}
