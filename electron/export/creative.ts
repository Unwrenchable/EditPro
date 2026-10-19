/**
 * Shared creative model for preview and export.
 *
 * Preview components and the ffmpeg planner both call these functions, so a
 * title, a volume curve, a lift/gamma/gain grade, and a transition land on the
 * same numbers in the monitor and in the encoded file.
 * No Node I/O — safe to import from the renderer and from unit tests.
 */

import {
  applyRgbCurves,
  createDefaultHdr,
  createIdentityCurves,
  mixRgb,
  normalizeHdr,
  normalizeRgbCurves,
  toneMapToSdr,
} from './grade.js';
import type { HdrSettings, RgbCurves } from './grade.js';

export type { CurveChannel, CurvePoint, HdrSettings, HdrTransfer, RgbCurves } from './grade.js';
export {
  applyLutStrength,
  applyRgbCurves,
  createIdentityCurves,
  curvesAreNeutral,
  curvesFilter,
  hdrMetadataArgs,
  rgbFromWheel,
  sampleCurve,
  shiftWheelMaster,
  toneMapToSdr,
  wheelFromRgb,
} from './grade.js';

export type EncoderChoice =
  | 'auto'
  | 'software'
  | 'h264_nvenc'
  | 'h264_qsv'
  | 'h264_amf'
  | 'h264_videotoolbox'
  | 'hevc_nvenc'
  | 'hevc_qsv'
  | 'hevc_amf'
  | 'hevc_videotoolbox';

export type DeliveryCodec = 'h264' | 'hevc' | 'prores' | 'vp9';

export interface VolumeKeyframe {
  id: string;
  /** Seconds from the start of the clip on the output timeline. */
  time: number;
  /** Linear gain, multiplied by the clip volume. 0–2. */
  gain: number;
}

export interface ProgramAudio {
  /** Linear clip gain, 0–2. */
  volume: number;
  /** Crossfade in, seconds. */
  fadeIn: number;
  /** Crossfade out, seconds. */
  fadeOut: number;
  keyframes: VolumeKeyframe[];
}

export interface ClipAudioEdit {
  clipId: string;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  keyframes: VolumeKeyframe[];
}

export interface TrackMix {
  trackId: string;
  /** Linear fader, 0–2. Mute and lock stay on the track itself. */
  volume: number;
  solo: boolean;
}

export type ClipTransitionKind =
  | 'cross-dissolve'
  | 'dip-to-black'
  | 'dip-to-white'
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-up'
  | 'wipe-down'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down';

export interface ClipTransition {
  id: string;
  trackId: string;
  outgoingClipId: string;
  incomingClipId: string;
  kind: ClipTransitionKind;
  duration: number;
}

export type TitleAnimation = 'none' | 'fade' | 'slide-up' | 'pop' | 'type-on';
export type TitlePresetId = 'custom' | 'lower-third' | 'center-title' | 'fade-credit' | 'pop-in';
export type TitleAlign = 'left' | 'center' | 'right';

export interface TitleClip {
  id: string;
  trackId: string;
  startTime: number;
  endTime: number;
  text: string;
  fontFamily: string;
  /** Font size as a percentage of the frame height. */
  fontSize: number;
  color: string;
  strokeColor: string;
  /** Stroke width as a percentage of the frame height. */
  strokeWidth: number;
  shadowColor: string;
  /** Shadow offsets and blur as a percentage of the frame height. */
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  /** Anchor, 0–1 of the frame. */
  x: number;
  y: number;
  align: TitleAlign;
  preset: TitlePresetId;
  animation: TitleAnimation;
}

export interface RgbTriplet {
  r: number;
  g: number;
  b: number;
}

/** Lift and gain are linear; gamma is the power (1 is neutral). */
export interface LiftGammaGain {
  lift: RgbTriplet;
  gamma: RgbTriplet;
  gain: RgbTriplet;
}

export interface CubeLut {
  title: string;
  size: number;
  /** Red changes fastest, then green, then blue. Length is size³. */
  samples: RgbTriplet[];
}

export interface LoudnessSettings {
  /** Integrated target. -14 is the YouTube / streaming default. */
  targetLufs: number;
  normalizeOnExport: boolean;
  /** Last meter reading. Null until the program has been measured. */
  measuredLufs: number | null;
}

export interface RenderQueueItem {
  id: string;
  presetId: string;
  encoder: EncoderChoice;
  codec: DeliveryCodec;
  quality: number;
  outputName: string;
}

export interface CreativeState {
  programAudio: ProgramAudio;
  clipAudio: ClipAudioEdit[];
  trackMix: TrackMix[];
  titles: TitleClip[];
  transitions: ClipTransition[];
  liftGammaGain: LiftGammaGain;
  /** RGB and luma curves. Identity until the user edits a point. */
  curves: RgbCurves;
  lut: CubeLut | null;
  /** 0–1 mix of the imported cube toward identity. */
  lutStrength: number;
  hdr: HdrSettings;
  loudness: LoudnessSettings;
  renderQueue: RenderQueueItem[];
  encoder: EncoderChoice;
}

export const TITLE_FONTS: readonly { id: string; label: string; css: string }[] = [
  { id: 'sans', label: 'Sans', css: 'Arial, Helvetica, sans-serif' },
  { id: 'serif', label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Mono', css: '"Courier New", Courier, monospace' },
  { id: 'impact', label: 'Impact', css: 'Impact, Haettenschweiler, sans-serif' },
];

export const TRANSITION_LIBRARY: readonly { id: ClipTransitionKind; label: string; xfade: string }[] = [
  { id: 'cross-dissolve', label: 'Cross Dissolve', xfade: 'fade' },
  { id: 'dip-to-black', label: 'Dip to Black', xfade: 'fadeblack' },
  { id: 'dip-to-white', label: 'Dip to White', xfade: 'fadewhite' },
  { id: 'wipe-left', label: 'Wipe Left', xfade: 'wipeleft' },
  { id: 'wipe-right', label: 'Wipe Right', xfade: 'wiperight' },
  { id: 'wipe-up', label: 'Wipe Up', xfade: 'wipeup' },
  { id: 'wipe-down', label: 'Wipe Down', xfade: 'wipedown' },
  { id: 'slide-left', label: 'Slide Left', xfade: 'slideleft' },
  { id: 'slide-right', label: 'Slide Right', xfade: 'slideright' },
  { id: 'slide-up', label: 'Slide Up', xfade: 'slideup' },
  { id: 'slide-down', label: 'Slide Down', xfade: 'slidedown' },
];

export const TITLE_INTRO_SEC = 0.45;

const ENCODER_IDS: readonly EncoderChoice[] = [
  'auto',
  'software',
  'h264_nvenc',
  'h264_qsv',
  'h264_amf',
  'h264_videotoolbox',
  'hevc_nvenc',
  'hevc_qsv',
  'hevc_amf',
  'hevc_videotoolbox',
];

const TRANSITION_IDS: readonly ClipTransitionKind[] = TRANSITION_LIBRARY.map((item) => item.id);
const TITLE_ANIMATIONS: readonly TitleAnimation[] = ['none', 'fade', 'slide-up', 'pop', 'type-on'];
const TITLE_PRESETS: readonly TitlePresetId[] = ['custom', 'lower-third', 'center-title', 'fade-credit', 'pop-in'];
const TITLE_ALIGNS: readonly TitleAlign[] = ['left', 'center', 'right'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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

function sec(value: number): string {
  return value.toFixed(3);
}

export function createDefaultProgramAudio(): ProgramAudio {
  return { volume: 1, fadeIn: 0, fadeOut: 0, keyframes: [] };
}

export function createDefaultLiftGammaGain(): LiftGammaGain {
  return {
    lift: { r: 0, g: 0, b: 0 },
    gamma: { r: 1, g: 1, b: 1 },
    gain: { r: 1, g: 1, b: 1 },
  };
}

export function createDefaultLoudness(): LoudnessSettings {
  return { targetLufs: -14, normalizeOnExport: false, measuredLufs: null };
}

export function createDefaultCreativeState(): CreativeState {
  return {
    programAudio: createDefaultProgramAudio(),
    clipAudio: [],
    trackMix: [],
    titles: [],
    transitions: [],
    liftGammaGain: createDefaultLiftGammaGain(),
    curves: createIdentityCurves(),
    lut: null,
    lutStrength: 1,
    hdr: createDefaultHdr(),
    loudness: createDefaultLoudness(),
    renderQueue: [],
    encoder: 'auto',
  };
}

export function createTitleFromPreset(preset: TitlePresetId, startTime: number, duration = 4): TitleClip {
  const base: TitleClip = {
    id: `title_${preset}`,
    trackId: 'v1',
    startTime,
    endTime: startTime + duration,
    text: 'Title',
    fontFamily: TITLE_FONTS[0].css,
    fontSize: 8,
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 0.3,
    shadowColor: '#000000',
    shadowBlur: 0.4,
    shadowOffsetX: 0.15,
    shadowOffsetY: 0.15,
    x: 0.5,
    y: 0.5,
    align: 'center',
    preset,
    animation: 'fade',
  };
  if (preset === 'lower-third') {
    return {
      ...base,
      text: 'Lower third',
      fontSize: 5.5,
      x: 0.08,
      y: 0.78,
      align: 'left',
      animation: 'slide-up',
      strokeWidth: 0.25,
    };
  }
  if (preset === 'center-title') {
    return { ...base, text: 'Title', fontSize: 10, y: 0.42, animation: 'fade' };
  }
  if (preset === 'fade-credit') {
    return { ...base, text: 'Credit', fontSize: 4.5, y: 0.5, animation: 'fade', strokeWidth: 0 };
  }
  if (preset === 'pop-in') {
    return { ...base, text: 'Pop', fontSize: 12, y: 0.36, animation: 'pop', fontFamily: TITLE_FONTS[3].css };
  }
  return { ...base, preset: 'custom', animation: 'none' };
}

function hexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function normalizeRgb(value: unknown, fallback: RgbTriplet, min: number, max: number): RgbTriplet {
  const record = asRecord(value);
  return {
    r: clamp(num(record?.r, fallback.r), min, max),
    g: clamp(num(record?.g, fallback.g), min, max),
    b: clamp(num(record?.b, fallback.b), min, max),
  };
}

function normalizeKeyframe(value: unknown): VolumeKeyframe | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  return {
    id: record.id,
    time: clamp(num(record.time, 0), 0, 86400),
    gain: clamp(num(record.gain, 1), 0, 2),
  };
}

function normalizeEnvelope(value: unknown, fallback: ProgramAudio): ProgramAudio {
  const record = asRecord(value);
  const keyframes = Array.isArray(record?.keyframes)
    ? record.keyframes.map(normalizeKeyframe).filter((item): item is VolumeKeyframe => item !== null)
    : [];
  return {
    volume: clamp(num(record?.volume, fallback.volume), 0, 2),
    fadeIn: clamp(num(record?.fadeIn, fallback.fadeIn), 0, 30),
    fadeOut: clamp(num(record?.fadeOut, fallback.fadeOut), 0, 30),
    keyframes,
  };
}

function normalizeClipAudio(value: unknown): ClipAudioEdit | null {
  const record = asRecord(value);
  if (!record || typeof record.clipId !== 'string' || !record.clipId) return null;
  const envelope = normalizeEnvelope(record, createDefaultProgramAudio());
  return { clipId: record.clipId, ...envelope };
}

function normalizeTrackMix(value: unknown): TrackMix | null {
  const record = asRecord(value);
  if (!record || typeof record.trackId !== 'string' || !record.trackId) return null;
  return {
    trackId: record.trackId,
    volume: clamp(num(record.volume, 1), 0, 2),
    solo: record.solo === true,
  };
}

function normalizeTitle(value: unknown): TitleClip | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  const preset = oneOf(record.preset, TITLE_PRESETS, 'custom');
  const seeded = createTitleFromPreset(preset, num(record.startTime, 0));
  const startTime = clamp(num(record.startTime, seeded.startTime), 0, 86400);
  const endTime = clamp(num(record.endTime, startTime + 4), startTime, 86400);
  return {
    id: record.id,
    trackId: str(record.trackId, 'v1'),
    startTime,
    endTime,
    text: str(record.text, seeded.text).slice(0, 120),
    fontFamily: str(record.fontFamily, seeded.fontFamily).slice(0, 160),
    fontSize: clamp(num(record.fontSize, seeded.fontSize), 1, 30),
    color: hexColor(record.color, seeded.color),
    strokeColor: hexColor(record.strokeColor, seeded.strokeColor),
    strokeWidth: clamp(num(record.strokeWidth, seeded.strokeWidth), 0, 4),
    shadowColor: hexColor(record.shadowColor, seeded.shadowColor),
    shadowBlur: clamp(num(record.shadowBlur, seeded.shadowBlur), 0, 8),
    shadowOffsetX: clamp(num(record.shadowOffsetX, seeded.shadowOffsetX), -8, 8),
    shadowOffsetY: clamp(num(record.shadowOffsetY, seeded.shadowOffsetY), -8, 8),
    x: clamp(num(record.x, seeded.x), 0, 1),
    y: clamp(num(record.y, seeded.y), 0, 1),
    align: oneOf(record.align, TITLE_ALIGNS, seeded.align),
    preset,
    animation: oneOf(record.animation, TITLE_ANIMATIONS, seeded.animation),
  };
}

function normalizeTransition(value: unknown): ClipTransition | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  if (typeof record.outgoingClipId !== 'string' || typeof record.incomingClipId !== 'string') return null;
  return {
    id: record.id,
    trackId: str(record.trackId, 'v1'),
    outgoingClipId: record.outgoingClipId,
    incomingClipId: record.incomingClipId,
    kind: oneOf(record.kind, TRANSITION_IDS, 'cross-dissolve'),
    duration: clamp(num(record.duration, 0.5), 0.05, 5),
  };
}

function normalizeQueueItem(value: unknown): RenderQueueItem | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  return {
    id: record.id,
    presetId: str(record.presetId, 'youtube'),
    encoder: oneOf(record.encoder, ENCODER_IDS, 'auto'),
    codec: oneOf(record.codec, ['h264', 'hevc', 'prores', 'vp9'] as const, 'h264'),
    quality: clamp(num(record.quality, 90), 1, 100),
    outputName: str(record.outputName, 'editpro.mp4').slice(0, 180),
  };
}

export function normalizeLut(value: unknown): CubeLut | null {
  const record = asRecord(value);
  if (!record) return null;
  const size = num(record.size, 0);
  if (!Number.isInteger(size) || size < 2 || size > 64) return null;
  if (!Array.isArray(record.samples) || record.samples.length !== size ** 3) return null;
  const samples: RgbTriplet[] = [];
  for (const sample of record.samples) {
    const point = asRecord(sample);
    if (!point) return null;
    const r = num(point.r, Number.NaN);
    const g = num(point.g, Number.NaN);
    const b = num(point.b, Number.NaN);
    if (![r, g, b].every((channel) => Number.isFinite(channel))) return null;
    samples.push({
      r: clamp(r, 0, 1),
      g: clamp(g, 0, 1),
      b: clamp(b, 0, 1),
    });
  }
  return {
    title: str(record.title, 'LUT').slice(0, 80) || 'LUT',
    size,
    samples,
  };
}

/** Fill anything an older project file left out. */
export function normalizeCreativeState(value: unknown): CreativeState {
  const defaults = createDefaultCreativeState();
  const record = asRecord(value);
  if (!record) return defaults;
  const grade = asRecord(record.liftGammaGain);
  return {
    programAudio: normalizeEnvelope(record.programAudio, defaults.programAudio),
    clipAudio: Array.isArray(record.clipAudio)
      ? record.clipAudio.map(normalizeClipAudio).filter((item): item is ClipAudioEdit => item !== null)
      : [],
    trackMix: Array.isArray(record.trackMix)
      ? record.trackMix.map(normalizeTrackMix).filter((item): item is TrackMix => item !== null)
      : [],
    titles: Array.isArray(record.titles)
      ? record.titles.map(normalizeTitle).filter((item): item is TitleClip => item !== null).slice(0, 32)
      : [],
    transitions: Array.isArray(record.transitions)
      ? record.transitions.map(normalizeTransition).filter((item): item is ClipTransition => item !== null).slice(0, 32)
      : [],
    liftGammaGain: {
      lift: normalizeRgb(grade?.lift, defaults.liftGammaGain.lift, -1, 1),
      gamma: normalizeRgb(grade?.gamma, defaults.liftGammaGain.gamma, 0.2, 3),
      gain: normalizeRgb(grade?.gain, defaults.liftGammaGain.gain, 0, 4),
    },
    curves: normalizeRgbCurves(record.curves),
    lut: normalizeLut(record.lut),
    lutStrength: clamp(num(record.lutStrength, defaults.lutStrength), 0, 1),
    hdr: normalizeHdr(record.hdr),
    loudness: {
      targetLufs: clamp(num(asRecord(record.loudness)?.targetLufs, defaults.loudness.targetLufs), -36, -5),
      normalizeOnExport: asRecord(record.loudness)?.normalizeOnExport === true,
      measuredLufs: (() => {
        const measured = asRecord(record.loudness)?.measuredLufs;
        return typeof measured === 'number' && Number.isFinite(measured) ? clamp(measured, -70, 0) : null;
      })(),
    },
    renderQueue: Array.isArray(record.renderQueue)
      ? record.renderQueue.map(normalizeQueueItem).filter((item): item is RenderQueueItem => item !== null).slice(0, 12)
      : [],
    encoder: oneOf(record.encoder, ENCODER_IDS, 'auto'),
  };
}

export function clipEnvelope(creative: CreativeState, clipId: string | null | undefined): ProgramAudio {
  if (!clipId) return creative.programAudio;
  return creative.clipAudio.find((item) => item.clipId === clipId) ?? createDefaultProgramAudio();
}

export function trackFader(
  tracks: readonly { id: string; muted: boolean }[],
  mix: readonly TrackMix[],
  trackId: string,
): number {
  const track = tracks.find((item) => item.id === trackId);
  if (!track || track.muted) return 0;
  const mine = mix.find((item) => item.trackId === trackId);
  const anySolo = mix.some((item) => item.solo && tracks.some((candidate) => candidate.id === item.trackId));
  if (anySolo && !mine?.solo) return 0;
  return mine?.volume ?? 1;
}

function sortedKeys(keyframes: readonly VolumeKeyframe[]): VolumeKeyframe[] {
  return [...keyframes].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

function interpolateGain(keyframes: readonly VolumeKeyframe[], time: number): number {
  const keys = sortedKeys(keyframes);
  if (keys.length === 0) return 1;
  if (time <= keys[0].time) return keys[0].gain;
  const last = keys[keys.length - 1];
  if (time >= last.time) return last.gain;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const left = keys[index];
    const right = keys[index + 1];
    if (time <= right.time) {
      const span = right.time - left.time;
      const amount = span <= 0.0001 ? 1 : (time - left.time) / span;
      return left.gain + (right.gain - left.gain) * amount;
    }
  }
  return last.gain;
}

/**
 * Linear gain at a local output time. Fade in/out are equal-power-free
 * linear crossfades — the same curve the ffmpeg volume expression uses.
 */
export function envelopeGain(audio: ProgramAudio, localTime: number, duration: number): number {
  const time = Math.max(0, localTime);
  let gain = audio.volume * interpolateGain(audio.keyframes, time);
  if (audio.fadeIn > 0.001) gain *= clamp(time / audio.fadeIn, 0, 1);
  if (audio.fadeOut > 0.001 && duration > 0) gain *= clamp((duration - time) / audio.fadeOut, 0, 1);
  return clamp(gain, 0, 4);
}

export function envelopeIsFlat(audio: ProgramAudio): boolean {
  return Math.abs(audio.volume - 1) < 0.0005 && audio.fadeIn <= 0.001 && audio.fadeOut <= 0.001 && audio.keyframes.length === 0;
}

function gainNumber(value: number): string {
  return value.toFixed(3);
}

/** ffmpeg `volume` expression. Commas are escaped for `-filter_complex`. */
export function volumeExpression(audio: ProgramAudio, duration: number, mixGain: number): string {
  const keys = sortedKeys(audio.keyframes);
  let curve = '1';
  if (keys.length === 1) {
    curve = gainNumber(keys[0].gain);
  } else if (keys.length > 1) {
    curve = gainNumber(keys[keys.length - 1].gain);
    for (let index = keys.length - 2; index >= 0; index -= 1) {
      const left = keys[index];
      const right = keys[index + 1];
      const span = right.time - left.time;
      const lerp = span <= 0.0001
        ? gainNumber(right.gain)
        : `${gainNumber(left.gain)}+(${gainNumber(right.gain)}-${gainNumber(left.gain)})*(t-${sec(left.time)})/${sec(span)}`;
      const segment = index === 0
        ? `if(lt(t\\,${sec(left.time)})\\,${gainNumber(left.gain)}\\,${lerp})`
        : lerp;
      curve = `if(lt(t\\,${sec(right.time)})\\,${segment}\\,${curve})`;
    }
  }
  const fadeIn = audio.fadeIn > 0.001 ? `min(1\\,t/${sec(audio.fadeIn)})` : '1';
  const fadeOut = audio.fadeOut > 0.001 && duration > 0
    ? `min(1\\,max(0\\,(${sec(duration)}-t)/${sec(audio.fadeOut)}))`
    : '1';
  const level = clamp(audio.volume * mixGain, 0, 4);
  return `${gainNumber(level)}*(${curve})*(${fadeIn})*(${fadeOut})`;
}

export function hasGainCurve(audio: ProgramAudio): boolean {
  return audio.fadeIn > 0.001 || audio.fadeOut > 0.001 || audio.keyframes.length > 0;
}

/** Expression filter for fades and keyframes. A constant fader stays on the planner's volume filter. */
export function volumeFilter(audio: ProgramAudio, duration: number, mixGain: number): string | null {
  if (!hasGainCurve(audio)) return null;
  return `volume=volume='${volumeExpression(audio, duration, mixGain)}':eval=frame`;
}

/**
 * Makeup gain that brings a measured integrated loudness onto the target.
 * Preview multiplies the monitor by this; export multiplies the same number.
 */
export function normalizeLinearGain(loudness: LoudnessSettings): number {
  if (!loudness.normalizeOnExport || loudness.measuredLufs === null) return 1;
  const db = clamp(loudness.targetLufs - loudness.measuredLufs, -24, 24);
  return clamp(10 ** (db / 20), 0, 4);
}

export function monitorLinearGain(input: {
  master: number;
  muted: boolean;
  tracks: readonly { id: string; muted: boolean }[];
  creative: CreativeState;
  sourceTime: number;
  trimStart: number;
  trimEnd: number;
  playbackRate: number;
  audioTrackId?: string;
}): number {
  if (input.muted || input.master <= 0) return 0;
  const trackId = input.audioTrackId ?? 'a1';
  const fader = trackFader(input.tracks, input.creative.trackMix, trackId);
  if (fader <= 0) return 0;
  const rate = input.playbackRate > 0 ? input.playbackRate : 1;
  const local = (input.sourceTime - input.trimStart) / rate;
  const duration = Math.max(0, (input.trimEnd - input.trimStart) / rate);
  const envelope = envelopeGain(input.creative.programAudio, local, duration);
  return clamp(input.master * fader * envelope * normalizeLinearGain(input.creative.loudness), 0, 4);
}

export interface TitlePlacement {
  text: string;
  opacity: number;
  x: number;
  y: number;
  /** Fraction of frame height. */
  fontSize: number;
  strokeWidth: number;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  color: string;
  strokeColor: string;
  shadowColor: string;
  fontFamily: string;
  align: TitleAlign;
}

export function typeOnCount(text: string, localTime: number, duration: number): number {
  if (!text) return 0;
  const window = Math.min(1.2, Math.max(0.2, duration * 0.45));
  const progress = clamp(localTime / window, 0, 1);
  return Math.floor(progress * text.length + 1e-6);
}

/** Placement in normalized frame space. Both the monitor and drawtext consume it. */
export function titlePlacement(title: TitleClip, sourceTime: number): TitlePlacement | null {
  const duration = title.endTime - title.startTime;
  const local = sourceTime - title.startTime;
  if (duration <= 0 || local < -0.0001 || local > duration + 0.0001) return null;
  const intro = Math.min(TITLE_INTRO_SEC, duration / 3);
  let opacity = 1;
  let y = title.y;
  let fontScale = 1;
  if (title.animation === 'fade') {
    if (intro > 0 && local < intro) opacity = local / intro;
    if (intro > 0 && local > duration - intro) opacity = Math.max(0, (duration - local) / intro);
  } else if (title.animation === 'slide-up') {
    const progress = intro > 0 ? clamp(local / intro, 0, 1) : 1;
    opacity = progress;
    y = title.y + (1 - progress) * 0.08;
  } else if (title.animation === 'pop') {
    const progress = intro > 0 ? clamp(local / intro, 0, 1) : 1;
    opacity = progress;
    fontScale = 0.6 + 0.4 * progress;
  }
  let text = title.text;
  if (title.animation === 'type-on') {
    text = title.text.slice(0, typeOnCount(title.text, local, duration));
    opacity = text.length > 0 ? 1 : 0;
  }
  return {
    text,
    opacity: clamp(opacity, 0, 1),
    x: title.x,
    y,
    fontSize: (title.fontSize / 100) * fontScale,
    strokeWidth: title.strokeWidth / 100,
    shadowBlur: title.shadowBlur / 100,
    shadowOffsetX: title.shadowOffsetX / 100,
    shadowOffsetY: title.shadowOffsetY / 100,
    color: title.color,
    strokeColor: title.strokeColor,
    shadowColor: title.shadowColor,
    fontFamily: title.fontFamily,
    align: title.align,
  };
}

export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function hexToFfmpeg(color: string, opacity: number): string {
  const alpha = Math.round(clamp(opacity, 0, 1) * 255).toString(16).padStart(2, '0');
  return `${color}${alpha}`;
}

export function drawtextFilter(
  title: TitleClip,
  frame: { width: number; height: number },
  trimStart: number,
  playbackRate: number,
  fontFile: string | null,
): string | null {
  if (!title.text.trim() || title.endTime <= title.startTime) return null;
  const rate = playbackRate > 0 ? playbackRate : 1;
  const start = (title.startTime - trimStart) / rate;
  const end = (title.endTime - trimStart) / rate;
  if (end <= 0) return null;
  const duration = title.endTime - title.startTime;
  const intro = Math.min(TITLE_INTRO_SEC, duration / 3) / rate;
  const fontSize = Math.max(8, Math.round((title.fontSize / 100) * frame.height));
  const border = Math.max(0, Math.round((title.strokeWidth / 100) * frame.height));
  const shadowX = Math.round((title.shadowOffsetX / 100) * frame.height);
  const shadowY = Math.round((title.shadowOffsetY / 100) * frame.height);
  const xPx = (title.x * frame.width).toFixed(2);
  const xExpr = title.align === 'center'
    ? `${xPx}-text_w/2`
    : title.align === 'right'
      ? `${xPx}-text_w`
      : xPx;
  let yExpr = (title.y * frame.height).toFixed(2);
  let alpha = '1';
  if (title.animation === 'fade' && intro > 0.001) {
    alpha = `if(lt(t\\,${sec(Math.max(0, start))})\\,0\\,if(lt(t\\,${sec(start + intro)})\\,(t-${sec(start)})/${sec(intro)}\\,if(gt(t\\,${sec(end - intro)})\\,(${sec(end)}-t)/${sec(intro)}\\,1)))`;
  } else if (title.animation === 'slide-up' && intro > 0.001) {
    alpha = `if(lt(t\\,${sec(start + intro)})\\,max(0\\,(t-${sec(start)})/${sec(intro)})\\,1)`;
    const rest = ((title.y + 0.08) * frame.height).toFixed(2);
    const delta = (0.08 * frame.height).toFixed(2);
    yExpr = `if(lt(t\\,${sec(start)})\\,${rest}\\,if(lt(t\\,${sec(start + intro)})\\,${rest}-${delta}*(t-${sec(start)})/${sec(intro)}\\,${yExpr}))`;
  } else if (title.animation === 'pop' && intro > 0.001) {
    alpha = `if(lt(t\\,${sec(start + intro)})\\,max(0\\,(t-${sec(start)})/${sec(intro)})\\,1)`;
  }
  const font = fontFile
    ? `fontfile='${fontFile.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")}'`
    : `font='${escapeDrawtext(title.fontFamily.split(',')[0]?.replace(/["']/g, '').trim() || 'Sans')}'`;
  const shown = title.text;
  return [
    'drawtext',
    `text='${escapeDrawtext(shown)}'`,
    font,
    `fontsize=${fontSize}`,
    `fontcolor=${hexToFfmpeg(title.color, 1)}`,
    `borderw=${border}`,
    `bordercolor=${hexToFfmpeg(title.strokeColor, 1)}`,
    `shadowcolor=${hexToFfmpeg(title.shadowColor, 1)}`,
    `shadowx=${shadowX}`,
    `shadowy=${shadowY}`,
    `x=${xExpr}`,
    `y=${yExpr}`,
    `alpha='${alpha}'`,
    `enable='between(t\\,${sec(Math.max(0, start))}\\,${sec(end)})'`,
  ].join(':');
}

/** One drawtext per revealed prefix so type-on matches {@link typeOnCount}. */
export function drawtextFilters(
  title: TitleClip,
  frame: { width: number; height: number },
  trimStart: number,
  playbackRate: number,
  fontFile: string | null,
): string[] {
  if (title.animation !== 'type-on') {
    const single = drawtextFilter(title, frame, trimStart, playbackRate, fontFile);
    return single ? [single] : [];
  }
  const rate = playbackRate > 0 ? playbackRate : 1;
  const start = Math.max(0, (title.startTime - trimStart) / rate);
  const end = (title.endTime - trimStart) / rate;
  const window = Math.min(1.2, Math.max(0.2, (title.endTime - title.startTime) * 0.45)) / rate;
  const filters: string[] = [];
  for (let count = 1; count <= title.text.length; count += 1) {
    const appear = start + window * (count / title.text.length);
    const next = count === title.text.length ? end : start + window * ((count + 1) / title.text.length);
    const partial: TitleClip = { ...title, animation: 'none', text: title.text.slice(0, count) };
    const filter = drawtextFilter(partial, frame, trimStart, playbackRate, fontFile);
    if (!filter) continue;
    filters.push(filter.replace(
      /enable='between\(t\\,[^']+\)'/,
      `enable='between(t\\,${sec(appear)}\\,${sec(next)})'`,
    ));
  }
  return filters;
}

export interface EdgePresentation {
  opacity: number;
  /** Visible width fraction for a wipe. 1 means the whole frame. */
  visibleWidth: number;
  /** Horizontal shift as a fraction of the frame width. */
  translateX: number;
  scale: number;
  veil: number;
  veilColor: '#000000' | '#ffffff' | null;
}

/**
 * Program-edge treatment. `fadeDistance` is `transitionDuration` from the
 * export planner so the monitor uses the same length as the fade filter.
 */
export function edgePresentation(
  transition: string,
  time: number,
  duration: number,
  fadeDistance: number,
): EdgePresentation {
  const identity: EdgePresentation = {
    opacity: 1,
    visibleWidth: 1,
    translateX: 0,
    scale: 1,
    veil: 0,
    veilColor: null,
  };
  if (transition === 'cut' || !(duration > 0) || !(fadeDistance > 0)) return identity;
  const dip = transition === 'dip-to-black' ? Math.min(duration / 3, fadeDistance * 1.35) : fadeDistance;
  const end = Math.max(0, duration - (transition === 'wipe' || transition === 'slide' || transition === 'zoom' ? fadeDistance : dip));
  const intro = transition === 'wipe' || transition === 'slide' || transition === 'zoom' ? fadeDistance : dip;
  if (transition === 'wipe') {
    let width = 1;
    if (time < intro) width = Math.max(0, time / intro);
    else if (time > end) width = Math.max(0, (duration - time) / fadeDistance);
    return { ...identity, visibleWidth: clamp(width, 0, 1) };
  }
  if (transition === 'slide') {
    let shift = 0;
    if (time < intro) shift = 1 - time / intro;
    else if (time > end) shift = (time - end) / fadeDistance;
    return { ...identity, translateX: clamp(shift, 0, 1) };
  }
  if (transition === 'zoom') {
    let scale = 1;
    if (time <= intro) scale = 1.35 - 0.35 * (time / intro);
    else if (time >= end) scale = 1 + 0.35 * ((time - end) / fadeDistance);
    return { ...identity, scale };
  }
  let opacity = 1;
  if (time < intro) opacity = intro <= 0 ? 1 : time / intro;
  else if (time > duration - intro) opacity = intro <= 0 ? 1 : (duration - time) / intro;
  return { ...identity, opacity: clamp(opacity, 0, 1), veilColor: '#000000' };
}

export interface TransitionFrame {
  outgoingOpacity: number;
  incomingOpacity: number;
  /** 0–1 visible fraction of the outgoing picture, from the matching edge. */
  outgoingVisible: number;
  /** Incoming slide offset, 0–1 of the frame. */
  incomingShift: number;
  veil: number;
  veilColor: '#000000' | '#ffffff' | null;
  /** 'x' or 'y' for wipes and slides. */
  axis: 'x' | 'y';
  /** 1 reveals toward the positive axis, -1 toward the negative. */
  direction: 1 | -1;
}

export function transitionFrame(kind: ClipTransitionKind, progress: number): TransitionFrame {
  const p = clamp(progress, 0, 1);
  const base: TransitionFrame = {
    outgoingOpacity: 1 - p,
    incomingOpacity: p,
    outgoingVisible: 1,
    incomingShift: 0,
    veil: 0,
    veilColor: null,
    axis: 'x',
    direction: 1,
  };
  if (kind === 'cross-dissolve') return base;
  if (kind === 'dip-to-black' || kind === 'dip-to-white') {
    const veil = p < 0.5 ? p * 2 : (1 - p) * 2;
    return {
      ...base,
      outgoingOpacity: p < 0.5 ? 1 - p * 2 : 0,
      incomingOpacity: p < 0.5 ? 0 : (p - 0.5) * 2,
      veil,
      veilColor: kind === 'dip-to-white' ? '#ffffff' : '#000000',
    };
  }
  const vertical = kind.endsWith('up') || kind.endsWith('down');
  const direction: 1 | -1 = kind.endsWith('left') || kind.endsWith('up') ? -1 : 1;
  if (kind.startsWith('wipe')) {
    return { ...base, outgoingOpacity: 1, incomingOpacity: 1, outgoingVisible: 1 - p, axis: vertical ? 'y' : 'x', direction };
  }
  return { ...base, outgoingOpacity: 1, incomingOpacity: 1, incomingShift: 1 - p, axis: vertical ? 'y' : 'x', direction };
}

export function xfadeName(kind: ClipTransitionKind): string {
  return TRANSITION_LIBRARY.find((item) => item.id === kind)?.xfade ?? 'fade';
}

export interface CutClip {
  id: string;
  trackId: string;
  startTime: number;
  endTime: number;
}

/** Drop a library transition onto the cut between two clips. */
export function placeTransition(
  clips: readonly CutClip[],
  outgoingClipId: string,
  incomingClipId: string,
  kind: ClipTransitionKind,
  requestedDuration = 0.6,
): ClipTransition | null {
  const outgoing = clips.find((clip) => clip.id === outgoingClipId);
  const incoming = clips.find((clip) => clip.id === incomingClipId);
  if (!outgoing || !incoming || outgoing.trackId !== incoming.trackId || outgoing.id === incoming.id) return null;
  const left = outgoing.endTime <= incoming.endTime ? outgoing : incoming;
  const right = left === outgoing ? incoming : outgoing;
  if (right.startTime - left.endTime > 0.25) return null;
  const room = Math.min(left.endTime - left.startTime, right.endTime - right.startTime) / 2;
  const duration = clamp(Math.min(requestedDuration, room), 0.05, 5);
  if (!(room >= 0.05)) return null;
  return {
    id: `xfade_${left.id}_${right.id}`,
    trackId: left.trackId,
    outgoingClipId: left.id,
    incomingClipId: right.id,
    kind,
    duration,
  };
}

/** Which library transition is active at `time`, plus 0–1 progress through it. */
export function activeTransitionAt(
  clips: readonly CutClip[],
  transitions: readonly ClipTransition[],
  time: number,
): { transition: ClipTransition; progress: number } | null {
  for (const transition of transitions) {
    const outgoing = clips.find((clip) => clip.id === transition.outgoingClipId);
    const incoming = clips.find((clip) => clip.id === transition.incomingClipId);
    if (!outgoing || !incoming) continue;
    const cut = outgoing.endTime;
    const start = cut - transition.duration;
    if (time >= start - 0.0001 && time <= cut + 0.0001) {
      const progress = transition.duration <= 0 ? 1 : (time - start) / transition.duration;
      return { transition, progress: clamp(progress, 0, 1) };
    }
  }
  return null;
}

export function applyLiftGammaGain(rgb: RgbTriplet, grade: LiftGammaGain): RgbTriplet {
  const channel = (value: number, lift: number, gamma: number, gain: number) => {
    const shaped = Math.max(0, value * gain + lift * (1 - value));
    return clamp(shaped ** (1 / Math.max(0.05, gamma)), 0, 1);
  };
  return {
    r: channel(rgb.r, grade.lift.r, grade.gamma.r, grade.gain.r),
    g: channel(rgb.g, grade.lift.g, grade.gamma.g, grade.gain.g),
    b: channel(rgb.b, grade.lift.b, grade.gamma.b, grade.gain.b),
  };
}

export function liftGammaGainIsNeutral(grade: LiftGammaGain): boolean {
  const neutral = createDefaultLiftGammaGain();
  const close = (a: RgbTriplet, b: RgbTriplet) =>
    Math.abs(a.r - b.r) < 0.0005 && Math.abs(a.g - b.g) < 0.0005 && Math.abs(a.b - b.b) < 0.0005;
  return close(grade.lift, neutral.lift) && close(grade.gamma, neutral.gamma) && close(grade.gain, neutral.gain);
}

/** ffmpeg `geq` implementing {@link applyLiftGammaGain}. Commas are escaped. */
export function liftGammaGainFilter(grade: LiftGammaGain): string | null {
  if (liftGammaGainIsNeutral(grade)) return null;
  const expr = (channel: 'r' | 'g' | 'b', lift: number, gamma: number, gain: number) => {
    const sample = `${channel}(X\\,Y)/255`;
    const shaped = `max(0\\,${sample}*${gain.toFixed(4)}+${lift.toFixed(4)}*(1-${sample}))`;
    return `clip(pow(${shaped}\\,${(1 / Math.max(0.05, gamma)).toFixed(4)})*255\\,0\\,255)`;
  };
  return [
    `r='${expr('r', grade.lift.r, grade.gamma.r, grade.gain.r)}'`,
    `g='${expr('g', grade.lift.g, grade.gamma.g, grade.gain.g)}'`,
    `b='${expr('b', grade.lift.b, grade.gamma.b, grade.gain.b)}'`,
  ].join(':').replace(/^/, 'geq=');
}

function lutIndex(size: number, r: number, g: number, b: number): number {
  return r + size * (g + size * b);
}

export function sampleLut(lut: CubeLut, rgb: RgbTriplet): RgbTriplet {
  const size = lut.size;
  const scale = size - 1;
  const r = clamp(rgb.r, 0, 1) * scale;
  const g = clamp(rgb.g, 0, 1) * scale;
  const b = clamp(rgb.b, 0, 1) * scale;
  const r0 = Math.floor(r);
  const g0 = Math.floor(g);
  const b0 = Math.floor(b);
  const r1 = Math.min(size - 1, r0 + 1);
  const g1 = Math.min(size - 1, g0 + 1);
  const b1 = Math.min(size - 1, b0 + 1);
  const fr = r - r0;
  const fg = g - g0;
  const fb = b - b0;
  const at = (ri: number, gi: number, bi: number) => lut.samples[lutIndex(size, ri, gi, bi)] ?? { r: 0, g: 0, b: 0 };
  const mix = (a: RgbTriplet, bSample: RgbTriplet, t: number): RgbTriplet => ({
    r: a.r + (bSample.r - a.r) * t,
    g: a.g + (bSample.g - a.g) * t,
    b: a.b + (bSample.b - a.b) * t,
  });
  const c00 = mix(at(r0, g0, b0), at(r1, g0, b0), fr);
  const c01 = mix(at(r0, g0, b1), at(r1, g0, b1), fr);
  const c10 = mix(at(r0, g1, b0), at(r1, g1, b0), fr);
  const c11 = mix(at(r0, g1, b1), at(r1, g1, b1), fr);
  return mix(mix(c00, c10, fg), mix(c01, c11, fg), fb);
}

export function applyGrade(
  rgb: RgbTriplet,
  grade: LiftGammaGain,
  lut: CubeLut | null,
  curves?: RgbCurves,
  lutStrength = 1,
  toneMap: HdrSettings | null = null,
): RgbTriplet {
  let next = applyLiftGammaGain(rgb, grade);
  next = applyRgbCurves(next, curves ?? createIdentityCurves());
  if (lut && lutStrength > 0.001) {
    const graded = sampleLut(lut, next);
    next = mixRgb(next, graded, lutStrength);
  }
  if (toneMap?.toneMapPreview && toneMap.transfer !== 'sdr') next = toneMapToSdr(next, toneMap.transfer);
  return next;
}

export function formatCube(lut: CubeLut): string {
  const lines = [`TITLE "${lut.title.replace(/"/g, '')}"`, `LUT_3D_SIZE ${lut.size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (const sample of lut.samples) {
    lines.push(`${sample.r.toFixed(6)} ${sample.g.toFixed(6)} ${sample.b.toFixed(6)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function parseCube(text: string): CubeLut | null {
  const samples: RgbTriplet[] = [];
  let size = 0;
  let title = 'LUT';
  let mode: 'unknown' | '3d' = 'unknown';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith('TITLE')) {
      title = line.replace(/^TITLE\s+/i, '').replace(/^"|"$/g, '').trim() || 'LUT';
      continue;
    }
    if (upper.startsWith('LUT_3D_SIZE')) {
      size = Number(line.split(/\s+/)[1]);
      mode = '3d';
      continue;
    }
    if (upper.startsWith('LUT_1D_SIZE') || upper.startsWith('DOMAIN_')) continue;
    if (mode !== '3d') continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) continue;
    samples.push({ r: parts[0], g: parts[1], b: parts[2] });
  }
  return normalizeLut({ title, size, samples });
}

export function lut3dFilter(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  return `lut3d=file='${normalized}'`;
}

export function waveformPeaks(samples: ArrayLike<number>, buckets: number): number[] {
  const count = Math.max(1, Math.floor(buckets));
  if (samples.length === 0) return new Array<number>(count).fill(0);
  const peaks = new Array<number>(count).fill(0);
  const span = samples.length / count;
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(index * span);
    const end = Math.max(start + 1, Math.floor((index + 1) * span));
    let peak = 0;
    for (let sample = start; sample < end && sample < samples.length; sample += 1) {
      const value = Math.abs(samples[sample] ?? 0);
      if (value > peak) peak = value;
    }
    peaks[index] = clamp(peak, 0, 1);
  }
  return peaks;
}

export function slicePeaks(
  peaks: readonly number[],
  mediaDuration: number,
  inPoint: number,
  outPoint: number,
): number[] {
  if (peaks.length === 0 || !(mediaDuration > 0) || outPoint <= inPoint) return [];
  const start = clamp(inPoint / mediaDuration, 0, 1);
  const end = clamp(outPoint / mediaDuration, 0, 1);
  const from = Math.floor(start * peaks.length);
  const to = Math.max(from + 1, Math.ceil(end * peaks.length));
  return peaks.slice(from, Math.min(peaks.length, to));
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function filterChannel(samples: Float32Array, coeffs: Biquad): Float32Array {
  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const x = samples[index];
    const y = coeffs.b0 * x + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2;
    out[index] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/** K-weighting coefficients from ITU-R BS.1770-4 for 48 kHz audio. */
const K_WEIGHT_PRE: Biquad = {
  b0: 1.53512485958697,
  b1: -2.69169618940638,
  b2: 1.19839281085285,
  a1: -1.69065929318241,
  a2: 0.73248077421585,
};
const K_WEIGHT_RLB: Biquad = {
  b0: 1,
  b1: -2,
  b2: 1,
  a1: -1.99004745483398,
  a2: 0.99007225036621,
};

function resampleTo48k(samples: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === 48000 || samples.length === 0) return samples;
  const outLength = Math.max(1, Math.round(samples.length * 48000 / sampleRate));
  const out = new Float32Array(outLength);
  for (let index = 0; index < outLength; index += 1) {
    const position = index * sampleRate / 48000;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    out[index] = (samples[left] ?? 0) * (1 - fraction) + (samples[right] ?? 0) * fraction;
  }
  return out;
}

function blockLoudness(samples: Float32Array, start: number, length: number): number {
  let sum = 0;
  const end = Math.min(samples.length, start + length);
  const count = end - start;
  if (count <= 0) return -70;
  for (let index = start; index < end; index += 1) sum += samples[index] * samples[index];
  const mean = sum / count;
  if (mean <= 1e-12) return -70;
  return -0.691 + 10 * Math.log10(mean);
}

export interface LoudnessReading {
  momentary: number;
  shortTerm: number;
  integrated: number;
}

/**
 * Momentary (400 ms), short-term (3 s) and gated integrated loudness.
 * Mono input is weighted at 1.0, per BS.1770.
 */
export function measureLoudness(samples: ArrayLike<number>, sampleRate: number): LoudnessReading {
  const mono = samples instanceof Float32Array ? samples : Float32Array.from(samples);
  const at48 = resampleTo48k(mono, sampleRate > 0 ? sampleRate : 48000);
  const weighted = filterChannel(filterChannel(at48, K_WEIGHT_PRE), K_WEIGHT_RLB);
  const momentary = blockLoudness(weighted, Math.max(0, weighted.length - 19200), 19200);
  const shortTerm = blockLoudness(weighted, Math.max(0, weighted.length - 144000), 144000);
  const hop = 4800;
  const block = 19200;
  const blocks: number[] = [];
  for (let start = 0; start + block <= weighted.length; start += hop) {
    blocks.push(blockLoudness(weighted, start, block));
  }
  if (blocks.length === 0) {
    const only = blockLoudness(weighted, 0, weighted.length);
    return { momentary: only, shortTerm: only, integrated: only };
  }
  const absolute = blocks.filter((value) => value >= -70);
  if (absolute.length === 0) return { momentary, shortTerm, integrated: -70 };
  const ungatedMean = absolute.reduce((sum, value) => sum + 10 ** (value / 10), 0) / absolute.length;
  const relativeGate = -0.691 + 10 * Math.log10(ungatedMean) - 10;
  const gated = absolute.filter((value) => value >= relativeGate);
  const chosen = gated.length > 0 ? gated : absolute;
  const energy = chosen.reduce((sum, value) => sum + 10 ** ((value + 0.691) / 10), 0) / chosen.length;
  const integrated = energy <= 1e-12 ? -70 : -0.691 + 10 * Math.log10(energy);
  return {
    momentary: Number(momentary.toFixed(1)),
    shortTerm: Number(shortTerm.toFixed(1)),
    integrated: Number(integrated.toFixed(1)),
  };
}

const GPU_PREFERENCE = ['nvenc', 'qsv', 'amf', 'videotoolbox'] as const;

export function softwareCodecName(format: 'mp4' | 'webm' | 'mov', codec: DeliveryCodec): string {
  if (format === 'webm' || codec === 'vp9') return 'libvpx-vp9';
  if (format === 'mov' || codec === 'prores') return 'prores_ks';
  if (codec === 'hevc') return 'libx265';
  return 'libx264';
}

export function selectVideoEncoder(input: {
  choice: EncoderChoice;
  available: readonly string[];
  format: 'mp4' | 'webm' | 'mov';
  codec: DeliveryCodec;
  platform: string;
}): { codec: string; hardware: boolean; fallback: string } {
  const fallback = softwareCodecName(input.format, input.codec);
  if (input.format === 'webm' || input.format === 'mov' || input.codec === 'vp9' || input.codec === 'prores') {
    return { codec: fallback, hardware: false, fallback };
  }
  if (input.choice === 'software') return { codec: fallback, hardware: false, fallback };
  if (input.choice !== 'auto') {
    const matchesFamily = input.codec === 'hevc' ? input.choice.startsWith('hevc_') : input.choice.startsWith('h264_');
    if (matchesFamily && input.available.includes(input.choice)) {
      return { codec: input.choice, hardware: true, fallback };
    }
    return { codec: fallback, hardware: false, fallback };
  }
  const order = input.platform === 'darwin'
    ? (['videotoolbox', 'nvenc', 'qsv', 'amf'] as const)
    : GPU_PREFERENCE;
  const prefix = input.codec === 'hevc' ? 'hevc_' : 'h264_';
  for (const vendor of order) {
    const name = `${prefix}${vendor}`;
    if (input.available.includes(name)) return { codec: name, hardware: true, fallback };
  }
  return { codec: fallback, hardware: false, fallback };
}

export function encoderArgs(codec: string, crf: number, quality: number): string[] {
  if (codec === 'libx264') {
    return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
  }
  if (codec === 'libx265') {
    return ['-c:v', 'libx265', '-preset', 'medium', '-crf', String(crf), '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p'];
  }
  if (codec === 'libvpx-vp9') {
    return ['-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-row-mt', '1', '-cpu-used', '2', '-deadline', 'good', '-pix_fmt', 'yuv420p'];
  }
  if (codec === 'prores_ks') {
    return ['-c:v', 'prores_ks', '-profile:v', String(quality >= 90 ? 3 : quality >= 70 ? 2 : 1), '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0'];
  }
  if (codec.endsWith('_nvenc')) {
    return ['-c:v', codec, '-preset', 'p4', '-rc', 'constqp', '-qp', String(crf), '-pix_fmt', 'yuv420p'];
  }
  if (codec.endsWith('_qsv')) {
    return ['-c:v', codec, '-preset', 'medium', '-global_quality', String(crf), '-pix_fmt', 'yuv420p'];
  }
  if (codec.endsWith('_amf')) {
    return ['-c:v', codec, '-quality', 'balanced', '-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf), '-pix_fmt', 'yuv420p'];
  }
  if (codec.endsWith('_videotoolbox')) {
    return ['-c:v', codec, '-q:v', String(Math.round(clamp(quality, 1, 100))), '-pix_fmt', 'yuv420p'];
  }
  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p'];
}

export function parseEncoderList(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*[VASFXBD.]{6}\s+(\w+)/.exec(line);
    if (match) found.push(match[1]);
  }
  return found;
}

export function isHardwareEncoderFailure(stderr: string): boolean {
  return /Unknown encoder|Encoder \(.*\) not found|Cannot load nv|No NVENC capable devices|Cannot load nvcuda|Error while opening encoder|Device creation failed|AMF (failed|error)|qsv initialization|videotoolbox.*error|not supported in this build/i.test(stderr);
}

export function siblingOutputPath(chosenPath: string, fileName: string): string {
  const normalized = chosenPath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const directory = slash >= 0 ? chosenPath.slice(0, slash) : '';
  const separator = chosenPath.includes('\\') ? '\\' : '/';
  const safe = fileName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'editpro.mp4';
  return directory ? `${directory}${separator}${safe}` : safe;
}

export const FONT_FILE_CANDIDATES: readonly string[] = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  'C:\\Windows\\Fonts\\arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
];

export function firstExistingFont(exists: (candidate: string) => boolean): string | null {
  return FONT_FILE_CANDIDATES.find((candidate) => {
    try {
      return exists(candidate);
    } catch {
      return false;
    }
  }) ?? null;
}
