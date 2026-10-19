/**
 * Pure video-export planner.
 *
 * Turns an edit (trim, Lumetri, Essential Sound, auto-reframe, transitions,
 * timeline clips) into an argv array for the bundled ffmpeg binary.
 * No Node I/O and no child_process — safe to unit test and to bundle
 * into the renderer for preflight checks. The Electron main process is the
 * only place that spawns ffmpeg.
 */

import {
  clipEnvelope,
  drawtextFilters,
  hasGainCurve,
  liftGammaGainFilter,
  lut3dFilter,
  normalizeCreativeState,
  normalizeLinearGain,
  selectVideoEncoder,
  softwareCodecName,
  trackFader,
  volumeFilter,
  xfadeName,
  encoderArgs,
  type CreativeState,
  type DeliveryCodec,
  type EncoderChoice,
} from './creative.js';
import { motionGraph, prepareKeyframes, type ExportKeyframe } from './motion.js';

export { keyframeExpression, motionGraph, prepareKeyframes } from './motion.js';
export type { ExportEase, ExportKeyframe, ExportKeyframeProperty } from './motion.js';

export class ExportPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportPlanError';
  }
}

export type AutoReframeAspect = '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | 'original';

export type VideoTransition =
  | 'cut'
  | 'fade'
  | 'dissolve'
  | 'crossfade'
  | 'wipe'
  | 'slide'
  | 'zoom'
  | 'dip-to-black';

export type ExportResolution = '4K' | '1080p' | '720p' | '480p';
export type ExportFrameRate = 24 | 30 | 60;
export type ExportFormat = 'mp4' | 'webm' | 'mov';
export type ExportPlatform =
  | 'youtube'
  | 'youtube-4k'
  | 'tiktok'
  | 'instagram'
  | 'vimeo'
  | 'twitter'
  | 'prores'
  | 'h265'
  | 'custom';

export interface ExportCurves {
  masterShadow: number;
  masterMidtone: number;
  masterHighlight: number;
  redShadow: number;
  redMidtone: number;
  redHighlight: number;
  greenShadow: number;
  greenMidtone: number;
  greenHighlight: number;
  blueShadow: number;
  blueMidtone: number;
  blueHighlight: number;
}

export interface ExportWheel {
  x: number;
  y: number;
  luminance: number;
}

export interface ExportLumetri {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  saturation: number;
  vibrance: number;
  curves: ExportCurves;
  wheels: {
    shadows: ExportWheel;
    midtones: ExportWheel;
    highlights: ExportWheel;
  };
}

export type ExportAudioCategory = 'dialogue' | 'music' | 'sfx' | 'ambience';

export interface ExportAudio {
  category: ExportAudioCategory;
  noiseReduction: number;
  clarity: number;
  deReverb: number;
  loudness: number;
  autoDuck: boolean;
  lowCut: boolean;
}

export interface ExportSourceClip {
  sourcePath: string;
  trackType: 'video' | 'audio';
  startTime: number;
  inPoint: number;
  outPoint: number;
  /** Set when the clip came from the timeline, so fades and transitions can find it. */
  clipId?: string;
  trackId?: string;
  /** Times are seconds from the clip's timeline start. */
  keyframes?: ExportKeyframe[];
}

export interface ExportOptions {
  resolution: ExportResolution;
  frameRate: ExportFrameRate;
  format: ExportFormat;
  quality: number;
  /** h264 unless a preset selects H.265, ProRes, or VP9. */
  codec?: 'h264' | 'hevc' | 'prores' | 'vp9';
  /** Missing means the software encoder, which keeps older jobs on libx264. */
  encoder?: EncoderChoice;
  /** Encoders reported by `ffmpeg -encoders`. Empty selects the software fallback. */
  availableEncoders?: readonly string[];
  /** Host platform, used when encoder is `auto`. */
  platform?: string;
}

export interface ExportJob {
  jobId: string;
  sourcePath: string;
  outputPath: string;
  trimStart: number;
  trimEnd: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  videoTrackMuted: boolean;
  audioTrackMuted: boolean;
  lumetri: ExportLumetri;
  audio: ExportAudio;
  autoReframe: AutoReframeAspect;
  transition: VideoTransition;
  clips: ExportSourceClip[];
  /** Program keyframes in absolute sequence time. Applied to the source segment. */
  keyframes?: ExportKeyframe[];
  options: ExportOptions;
  /** Titles, grade, mixer, and per-clip transitions. Omitted on older jobs. */
  creative?: CreativeState;
}

export interface ExportPlan {
  args: string[];
  outputPath: string;
  outputDurationSec: number;
  width: number;
  height: number;
  frameRate: ExportFrameRate;
  format: ExportFormat;
  videoCodec: string;
  audioCodec: string | null;
  /** True when a video-only source can be retried without an audio map. */
  canRetryWithoutAudio: boolean;
  warnings: string[];
}

export interface PlatformPreset {
  id: ExportPlatform;
  label: string;
  resolution: ExportResolution;
  frameRate: ExportFrameRate;
  format: ExportFormat;
  /** Null keeps the timeline auto-reframe. */
  aspect: AutoReframeAspect | null;
  codec: 'h264' | 'hevc' | 'prores' | 'vp9';
}

export const PLATFORM_PRESETS: readonly PlatformPreset[] = [
  { id: 'youtube', label: 'YouTube 1080p', resolution: '1080p', frameRate: 30, format: 'mp4', aspect: null, codec: 'h264' },
  { id: 'youtube-4k', label: 'YouTube 4K', resolution: '4K', frameRate: 30, format: 'mp4', aspect: '16:9', codec: 'h264' },
  { id: 'tiktok', label: 'TikTok / Reels', resolution: '1080p', frameRate: 30, format: 'mp4', aspect: '9:16', codec: 'h264' },
  { id: 'instagram', label: 'Instagram', resolution: '1080p', frameRate: 30, format: 'mp4', aspect: '4:5', codec: 'h264' },
  { id: 'vimeo', label: 'Vimeo HD', resolution: '1080p', frameRate: 24, format: 'mp4', aspect: null, codec: 'h264' },
  { id: 'twitter', label: 'Twitter / X', resolution: '720p', frameRate: 30, format: 'mp4', aspect: null, codec: 'h264' },
  { id: 'prores', label: 'ProRes', resolution: '1080p', frameRate: 24, format: 'mov', aspect: null, codec: 'prores' },
  { id: 'h265', label: 'H.265', resolution: '1080p', frameRate: 30, format: 'mp4', aspect: null, codec: 'hevc' },
  { id: 'custom', label: 'Custom', resolution: '1080p', frameRate: 30, format: 'mp4', aspect: null, codec: 'h264' },
];

export const TRANSITION_OPTIONS: readonly { id: VideoTransition; label: string }[] = [
  { id: 'cut', label: 'Cut' },
  { id: 'fade', label: 'Fade' },
  { id: 'dissolve', label: 'Dissolve' },
  { id: 'crossfade', label: 'Cross-Fade' },
  { id: 'wipe', label: 'Wipe' },
  { id: 'slide', label: 'Slide' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'dip-to-black', label: 'Dip to Black' },
];

const RESOLUTIONS: readonly ExportResolution[] = ['4K', '1080p', '720p', '480p'];
const FORMATS: readonly ExportFormat[] = ['mp4', 'webm', 'mov'];
const TRANSITIONS: readonly VideoTransition[] = TRANSITION_OPTIONS.map((t) => t.id);
const ASPECTS: readonly AutoReframeAspect[] = ['16:9', '9:16', '1:1', '4:5', '4:3', 'original'];
const CATEGORIES: readonly ExportAudioCategory[] = ['dialogue', 'music', 'sfx', 'ambience'];

const CURVE_KEYS: readonly (keyof ExportCurves)[] = [
  'masterShadow', 'masterMidtone', 'masterHighlight',
  'redShadow', 'redMidtone', 'redHighlight',
  'greenShadow', 'greenMidtone', 'greenHighlight',
  'blueShadow', 'blueMidtone', 'blueHighlight',
];

const XFADE: Record<Exclude<VideoTransition, 'cut'>, string> = {
  fade: 'fade',
  dissolve: 'dissolve',
  crossfade: 'fade',
  wipe: 'wipeleft',
  slide: 'slideleft',
  zoom: 'zoomin',
  'dip-to-black': 'fadeblack',
};

export interface BuildOptions {
  /** When false, the graph is video-only. Used to retry sources that have no audio. */
  includeAudio?: boolean;
  /** Written .cube for an imported LUT. The planner does not touch the disk. */
  lutCubePath?: string | null;
  /** Face used by drawtext so the encoded titles match the monitor family. */
  fontFile?: string | null;
}

interface MediaSegment {
  sourcePath: string;
  ss: number;
  to: number;
  timelineStart: number;
  duration: number;
  role: 'primary-video' | 'video-clip' | 'audio-clip';
  clipId?: string;
  trackId?: string;
  keyframes?: ExportKeyframe[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sec(value: number): string {
  return value.toFixed(3);
}

function formatRate(rate: number): string {
  return String(Number(rate.toFixed(4)));
}

function near(value: number, target = 0, epsilon = 0.0005): boolean {
  return Math.abs(value - target) < epsilon;
}

export function isAbsolutePath(filePath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('/') || filePath.startsWith('\\\\');
}

export function isFilesystemPath(src: string): boolean {
  if (!src || src.startsWith('blob:') || src.startsWith('data:')) return false;
  if (src.startsWith('file://')) return true;
  return isAbsolutePath(src);
}

export function fileUrlToPath(src: string): string {
  if (!src.startsWith('file://')) return src;
  const url = new URL(src);
  let pathname = decodeURIComponent(url.pathname);
  if (/^\/[a-zA-Z]:\//.test(pathname)) pathname = pathname.slice(1);
  return pathname;
}

export function pathsEqual(a: string, b: string, caseInsensitive = false): boolean {
  const norm = (p: string) => {
    const n = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return caseInsensitive ? n.toLowerCase() : n;
  };
  return norm(a) === norm(b);
}

export function suggestExportFilename(
  sourceName: string,
  options: Pick<ExportOptions, 'resolution' | 'frameRate' | 'format'>
): string {
  const base = (sourceName.replace(/\.[^.]+$/, '') || 'editpro').replace(/[<>:"/\\|?*]/g, '_').trim() || 'editpro';
  return `${base}_${options.resolution}_${options.frameRate}fps.${options.format}`;
}

export function ensureExtension(outputPath: string, format: ExportFormat): string {
  const trimmed = outputPath.replace(/[\\/]+$/, '');
  if (new RegExp(`\\.${format}$`, 'i').test(trimmed)) return trimmed;
  const stripped = trimmed.replace(/\.[^\\/.]+$/, '');
  return `${stripped}.${format}`;
}

/**
 * Map the 1–100 quality slider onto x264/VP9 CRF (lower is higher quality).
 * 100 → 16, 40 → about 26, 1 → 32.
 */
export function qualityToCrf(quality: number): number {
  const q = clamp(quality, 1, 100);
  return Math.round(clamp(32 - (q / 100) * 16, 16, 32));
}

export function qualityToProresProfile(quality: number): number {
  if (quality >= 90) return 3;
  if (quality >= 70) return 2;
  return 1;
}

export function audioBitrate(quality: number): string {
  if (quality >= 80) return '192k';
  if (quality >= 60) return '160k';
  return '128k';
}

export function outputSize(
  resolution: ExportResolution,
  aspect: AutoReframeAspect
): { width: number; height: number } {
  const base: Record<ExportResolution, { width: number; height: number }> = {
    '4K': { width: 3840, height: 2160 },
    '1080p': { width: 1920, height: 1080 },
    '720p': { width: 1280, height: 720 },
    '480p': { width: 854, height: 480 },
  };
  const { width, height } = base[resolution];
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const even = (n: number) => {
    const r = Math.round(n);
    return r % 2 === 0 ? r : r - 1;
  };
  switch (aspect) {
    case '9:16':
      return { width: short, height: long };
    case '1:1':
      return { width: short, height: short };
    case '4:5':
      return { width: short, height: even(short * 1.25) };
    case '4:3':
      return { width: even(short * 4 / 3), height: short };
    default:
      return { width, height };
  }
}

export function transitionDuration(outputDurationSec: number): number {
  if (!(outputDurationSec > 0)) return 0;
  const wanted = Math.min(0.6, Math.max(0.1, outputDurationSec / 5));
  return Math.min(wanted, outputDurationSec / 3);
}

export function atempoChain(rate: number): string | null {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new ExportPlanError('Playback rate must be a positive number.');
  }
  if (near(rate, 1, 0.001)) return null;
  const parts: string[] = [];
  let remaining = rate;
  while (remaining < 0.5 - 1e-6) {
    parts.push('atempo=0.5');
    remaining /= 0.5;
  }
  while (remaining > 2 + 1e-6) {
    parts.push('atempo=2');
    remaining /= 2;
  }
  parts.push(`atempo=${formatRate(remaining)}`);
  return parts.join(',');
}

export function rewriteAsarPath(binaryPath: string): string {
  return binaryPath.replace(/app\.asar(?=[\\/])/g, 'app.asar.unpacked');
}

export function ffmpegCandidates(options: {
  packaged: boolean;
  platform: string;
  resourcesPath: string;
  ffmpegStaticPath: string | null;
}): string[] {
  const exe = options.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const join = (dir: string, name: string) => {
    const sep = dir.includes('\\') ? '\\' : '/';
    return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`;
  };
  const list: string[] = [];
  if (options.packaged) {
    list.push(join(join(options.resourcesPath, 'ffmpeg-static'), exe));
    list.push(join(options.resourcesPath, exe));
  }
  if (options.ffmpegStaticPath) {
    const rewritten = rewriteAsarPath(options.ffmpegStaticPath);
    list.push(rewritten);
    if (rewritten !== options.ffmpegStaticPath) list.push(options.ffmpegStaticPath);
  }
  return [...new Set(list)];
}

export function resolveFfmpegBinary(options: {
  packaged: boolean;
  platform: string;
  resourcesPath: string;
  ffmpegStaticPath: string | null;
  exists: (candidate: string) => boolean;
}): string {
  const list = ffmpegCandidates(options);
  for (const candidate of list) {
    if (options.exists(candidate)) return candidate;
  }
  const looked = list.length > 0 ? list.join(', ') : '(no candidates)';
  throw new ExportPlanError(
    `Bundled ffmpeg was not found. Looked in: ${looked}. On Windows, package with npm run dist:win so electron-builder copies ffmpeg.exe out of the app archive (extraResources and asarUnpack).`
  );
}

export function ffmpegStopAction(
  pid: number,
  platform: string
): { kind: 'signal'; signal: 'SIGTERM' } | { kind: 'command'; file: string; args: string[] } {
  if (platform === 'win32') {
    return { kind: 'command', file: 'taskkill', args: ['/pid', String(pid), '/t', '/f'] };
  }
  return { kind: 'signal', signal: 'SIGTERM' };
}

export function progressFromOutTime(outTimeSec: number, outputDurationSec: number): number {
  if (!(outputDurationSec > 0) || !Number.isFinite(outTimeSec)) return 0;
  return Math.max(0, Math.min(99.9, (outTimeSec / outputDurationSec) * 100));
}

export function parseClockSeconds(clock: string): number | null {
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(clock.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export interface ProgressUpdate {
  percent: number;
  timeSec: number;
  fps: number | null;
  done: boolean;
}

export function createProgressParser(): {
  push: (chunk: string, outputDurationSec: number) => ProgressUpdate[];
} {
  let buffer = '';
  let timeSec: number | null = null;
  let fps: number | null = null;
  return {
    push(chunk, outputDurationSec) {
      buffer += chunk;
      const updates: ProgressUpdate[] = [];
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('out_time=')) {
          const parsed = parseClockSeconds(line.slice('out_time='.length));
          if (parsed !== null) timeSec = parsed;
        } else if (line.startsWith('fps=')) {
          const value = Number(line.slice(4));
          if (Number.isFinite(value)) fps = value;
        } else if (line.startsWith('progress=')) {
          const done = line.slice('progress='.length).trim() === 'end';
          const t = timeSec ?? 0;
          updates.push({
            percent: done ? 100 : progressFromOutTime(t, outputDurationSec),
            timeSec: t,
            fps,
            done,
          });
        }
        newline = buffer.indexOf('\n');
      }
      return updates;
    },
  };
}

export function isMissingAudioError(stderr: string): boolean {
  return /matches no streams|Stream specifier|does not contain any stream|Failed to configure output pad/i.test(stderr);
}

export function explainSpawnError(error: { code?: string; message?: string }): string {
  if (error.code === 'ENOENT') {
    return 'Export failed: the bundled ffmpeg binary was not found. Run npm install, then on Windows rebuild with npm run dist:win so ffmpeg.exe is unpacked from the app archive.';
  }
  if (error.code === 'EACCES') {
    return 'Export failed: ffmpeg is not allowed to run. On Windows, antivirus may have blocked ffmpeg.exe. On macOS or Linux, reinstall the app so the binary is executable.';
  }
  return `Export failed: could not start ffmpeg. ${error.message ?? ''}`.trim();
}

export function explainFfmpegFailure(code: number | null, stderr: string): string {
  const text = stderr.trim();
  const last = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('frame=') && !line.startsWith('size='))
    .slice(-2)
    .join(' ')
    .slice(0, 300);
  if (/permission denied/i.test(text)) {
    return 'Export failed: permission denied writing the output file. Choose a folder you can write to.';
  }
  if (/no space left|disk full|ENOSPC/i.test(text)) {
    return 'Export failed: the disk is full.';
  }
  if (/invalid data found|moov atom not found|Invalid data/i.test(text)) {
    return 'Export failed: the source is not a readable video, or the file is still being copied.';
  }
  if (isMissingAudioError(text)) {
    return 'Export failed: ffmpeg could not find an audio stream required by this edit. A video-only file is retried automatically; timeline clips each need their own audio stream.';
  }
  if (/Unknown encoder|Encoder \(.*\) not found|Unknown encoder/i.test(text)) {
    return 'Export failed: this ffmpeg build does not include the selected encoder. Choose MP4 (H.264).';
  }
  if (/No such file or directory/i.test(text)) {
    return 'Export failed: a source file could not be opened. It may have moved.';
  }
  if (/Conversion failed|Error opening output|Invalid argument/i.test(text) && last) {
    return `Export failed (ffmpeg exit ${code ?? 'unknown'}). ${last}`;
  }
  if (code === null) return 'Export failed: ffmpeg exited unexpectedly.';
  return `Export failed (ffmpeg exit ${code}). ${last || 'No ffmpeg details were reported.'}`;
}

export function unwrapIpcError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'Export failed.');
  const stripped = raw.replace(/^Error invoking remote method '[^']+':\s*/i, '');
  return stripped || 'Export failed.';
}

function assertSafePath(filePath: string, label: string): string {
  if (typeof filePath !== 'string' || filePath.trim().length === 0 || filePath.length > 4096) {
    throw new ExportPlanError(`${label} is missing.`);
  }
  if (filePath.includes('\0') || /[\r\n]/.test(filePath)) {
    throw new ExportPlanError(`${label} contains invalid characters.`);
  }
  if (filePath.startsWith('-')) {
    throw new ExportPlanError(`${label} is not a valid file path.`);
  }
  if (!isAbsolutePath(filePath)) {
    throw new ExportPlanError(`${label} must be a full file path.`);
  }
  return filePath;
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExportPlanError(`${label} is missing or invalid.`);
  }
  return value as Record<string, unknown>;
}

function readNumber(source: Record<string, unknown>, key: string, label: string, min: number, max: number): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ExportPlanError(`${label} must be a number from ${min} to ${max}.`);
  }
  return value;
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ExportPlanError(`${label} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

function readBool(source: Record<string, unknown>, key: string, label: string): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') throw new ExportPlanError(`${label} is missing.`);
  return value;
}

function parseLumetri(value: unknown): ExportLumetri {
  const source = readRecord(value, 'Color grade');
  const basic = (key: keyof Omit<ExportLumetri, 'curves' | 'wheels'>, min: number, max: number) =>
    readNumber(source, key, `Lumetri ${key}`, min, max);
  const curvesIn = readRecord(source.curves, 'Lumetri curves');
  const curves = {} as ExportCurves;
  for (const key of CURVE_KEYS) {
    curves[key] = readNumber(curvesIn, key, `Lumetri curve ${key}`, -100, 100);
  }
  const wheelsIn = readRecord(source.wheels, 'Color wheels');
  const wheel = (name: 'shadows' | 'midtones' | 'highlights'): ExportWheel => {
    const w = readRecord(wheelsIn[name], `Color wheel ${name}`);
    return {
      x: readNumber(w, 'x', `Color wheel ${name} x`, -1, 1),
      y: readNumber(w, 'y', `Color wheel ${name} y`, -1, 1),
      luminance: readNumber(w, 'luminance', `Color wheel ${name} luminance`, -100, 100),
    };
  };
  return {
    exposure: basic('exposure', -5, 5),
    contrast: basic('contrast', -100, 100),
    highlights: basic('highlights', -100, 100),
    shadows: basic('shadows', -100, 100),
    whites: basic('whites', -100, 100),
    blacks: basic('blacks', -100, 100),
    temperature: basic('temperature', -100, 100),
    tint: basic('tint', -100, 100),
    saturation: basic('saturation', -100, 100),
    vibrance: basic('vibrance', -100, 100),
    curves,
    wheels: {
      shadows: wheel('shadows'),
      midtones: wheel('midtones'),
      highlights: wheel('highlights'),
    },
  };
}

function parseAudio(value: unknown): ExportAudio {
  const source = readRecord(value, 'Audio settings');
  return {
    category: readEnum(source.category, CATEGORIES, 'Audio category'),
    noiseReduction: readNumber(source, 'noiseReduction', 'Noise reduction', 0, 100),
    clarity: readNumber(source, 'clarity', 'Clarity', 0, 100),
    deReverb: readNumber(source, 'deReverb', 'De-reverb', 0, 100),
    loudness: readNumber(source, 'loudness', 'Loudness', -24, 6),
    autoDuck: readBool(source, 'autoDuck', 'Auto duck'),
    lowCut: readBool(source, 'lowCut', 'Low cut'),
  };
}

const EASES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'] as const;
const KEYFRAME_PROPERTIES = ['positionX', 'positionY', 'scale', 'rotation', 'opacity', 'effect'] as const;

function parseKeyframe(value: unknown, label: string): ExportKeyframe {
  const source = readRecord(value, label);
  const property = readEnum(source.property, KEYFRAME_PROPERTIES, `${label} property`);
  const keyframe: ExportKeyframe = {
    time: readNumber(source, 'time', `${label} time`, 0, 86400),
    property,
    value: readNumber(source, 'value', `${label} value`, -10000, 10000),
    easing: readEnum(source.easing, EASES, `${label} easing`),
  };
  if (property === 'effect') {
    const param = source.effectParam;
    if (typeof param !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(param)) {
      throw new ExportPlanError(`${label} needs an effect parameter name.`);
    }
    keyframe.effectParam = param;
  }
  return keyframe;
}

function parseKeyframes(value: unknown, label: string): ExportKeyframe[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ExportPlanError(`${label} are invalid.`);
  if (value.length > 128) throw new ExportPlanError(`${label} supports up to 128 keyframes.`);
  if (value.length === 0) return undefined;
  return value.map((entry, index) => parseKeyframe(entry, `${label} ${index + 1}`));
}

function parseClip(value: unknown, index: number): ExportSourceClip {
  const source = readRecord(value, `Timeline clip ${index + 1}`);
  const inPoint = readNumber(source, 'inPoint', `Clip ${index + 1} in point`, 0, 86400);
  const outPoint = readNumber(source, 'outPoint', `Clip ${index + 1} out point`, 0, 86400);
  if (outPoint <= inPoint + 0.04) {
    throw new ExportPlanError(`Timeline clip ${index + 1} is empty. Each clip needs an In and Out.`);
  }
  const clip: ExportSourceClip = {
    sourcePath: assertSafePath(String(source.sourcePath ?? ''), `Timeline clip ${index + 1}`),
    trackType: readEnum(source.trackType, ['video', 'audio'] as const, `Clip ${index + 1} track type`),
    startTime: readNumber(source, 'startTime', `Clip ${index + 1} start`, 0, 86400),
    inPoint,
    outPoint,
  };
  if (typeof source.clipId === 'string' && source.clipId) clip.clipId = source.clipId;
  if (typeof source.trackId === 'string' && source.trackId) clip.trackId = source.trackId;
  const keyframes = parseKeyframes(source.keyframes, `Clip ${index + 1} keyframes`);
  if (keyframes) clip.keyframes = keyframes;
  return clip;
}

/** Validate a renderer payload before it reaches ffmpeg. */
export function parseExportJob(input: unknown): ExportJob {
  const source = readRecord(input, 'Export request');
  const jobId = source.jobId;
  if (typeof jobId !== 'string' || !/^[0-9a-f-]{8,80}$/i.test(jobId)) {
    throw new ExportPlanError('Export job id is invalid.');
  }
  const optionsIn = readRecord(source.options, 'Export options');
  const frameRate = optionsIn.frameRate;
  if (frameRate !== 24 && frameRate !== 30 && frameRate !== 60) {
    throw new ExportPlanError('Frame rate must be 24, 30, or 60.');
  }
  const clipsIn = source.clips ?? [];
  if (!Array.isArray(clipsIn)) throw new ExportPlanError('Timeline clips are invalid.');
  if (clipsIn.length > 24) throw new ExportPlanError('Export supports up to 24 timeline clips.');
  const keyframes = parseKeyframes(source.keyframes, 'Program keyframes');
  const encoder = optionsIn.encoder === undefined
    ? 'software'
    : readEnum(optionsIn.encoder, ['auto', 'software', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox', 'hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'hevc_videotoolbox'] as const, 'Encoder');
  const codec = optionsIn.codec === undefined
    ? undefined
    : readEnum(optionsIn.codec, ['h264', 'hevc', 'prores', 'vp9'] as const, 'Codec');
  const availableEncoders = Array.isArray(optionsIn.availableEncoders)
    ? optionsIn.availableEncoders.filter((item): item is string => typeof item === 'string').slice(0, 64)
    : [];
  const platform = typeof optionsIn.platform === 'string' ? optionsIn.platform : undefined;
  return {
    jobId,
    sourcePath: assertSafePath(String(source.sourcePath ?? ''), 'Source video'),
    outputPath: assertSafePath(String(source.outputPath ?? ''), 'Output file'),
    trimStart: readNumber(source, 'trimStart', 'In point', 0, 86400),
    trimEnd: readNumber(source, 'trimEnd', 'Out point', 0, 86400),
    playbackRate: readNumber(source, 'playbackRate', 'Playback rate', 0.05, 4),
    volume: readNumber(source, 'volume', 'Volume', 0, 1),
    muted: readBool(source, 'muted', 'Mute'),
    videoTrackMuted: readBool(source, 'videoTrackMuted', 'Video track mute'),
    audioTrackMuted: readBool(source, 'audioTrackMuted', 'Audio track mute'),
    lumetri: parseLumetri(source.lumetri),
    audio: parseAudio(source.audio),
    autoReframe: readEnum(source.autoReframe, ASPECTS, 'Auto reframe'),
    transition: readEnum(source.transition, TRANSITIONS, 'Transition'),
    clips: clipsIn.map((clip, index) => parseClip(clip, index)),
    ...(keyframes ? { keyframes } : {}),
    options: {
      resolution: readEnum(optionsIn.resolution, RESOLUTIONS, 'Resolution'),
      frameRate,
      format: readEnum(optionsIn.format, FORMATS, 'Format'),
      quality: readNumber(optionsIn, 'quality', 'Quality', 1, 100),
      encoder,
      ...(codec ? { codec } : {}),
      ...(availableEncoders.length > 0 ? { availableEncoders } : {}),
      ...(platform ? { platform } : {}),
    },
    ...(source.creative !== undefined ? { creative: normalizeCreativeState(source.creative) } : {}),
  };
}

function curvePoints(shadow: number, mid: number, high: number): string {
  const y0 = clamp(shadow > 0 ? shadow / 250 : 0, 0, 0.4);
  const yMid = clamp(0.5 + mid / 200, 0.05, 0.95);
  const y1 = clamp(high >= 0 ? 1 : 1 + high / 250, 0.6, 1);
  if (shadow < 0) {
    const yLow = clamp(0.2 + shadow / 250, 0, 0.2);
    return `0/${y0.toFixed(3)} 0.25/${yLow.toFixed(3)} 0.5/${yMid.toFixed(3)} 1/${y1.toFixed(3)}`;
  }
  return `0/${y0.toFixed(3)} 0.5/${yMid.toFixed(3)} 1/${y1.toFixed(3)}`;
}

function curveChanged(shadow: number, mid: number, high: number): boolean {
  return !near(shadow) || !near(mid) || !near(high);
}

/** Lumetri → ffmpeg video filters (exposure, eq, temperature, wheels, curves). */
export function lumetriFilters(lut: ExportLumetri): string[] {
  const filters: string[] = [];
  if (!near(lut.exposure)) {
    filters.push(`exposure=exposure=${clamp(lut.exposure, -3, 3).toFixed(3)}`);
  }

  const wheelLum =
    (lut.wheels.shadows.luminance * 0.3 +
      lut.wheels.midtones.luminance * 0.5 +
      lut.wheels.highlights.luminance * 0.3) /
    100;
  const brightness = clamp(
    lut.highlights * 0.0012 +
      lut.shadows * 0.002 +
      (lut.whites - lut.blacks) / 500 +
      wheelLum * 0.15,
    -1,
    1
  );
  const contrast = clamp(1 + lut.contrast / 100 + (lut.whites + lut.blacks) / 800, 0, 3);
  const gamma = clamp(1 - lut.shadows / 400 + lut.highlights / 500, 0.1, 10);
  const saturation = clamp(1 + (lut.saturation + lut.vibrance * 0.7) / 100, 0, 3);
  if (!near(brightness) || !near(contrast, 1) || !near(gamma, 1) || !near(saturation, 1)) {
    filters.push(
      `eq=contrast=${contrast.toFixed(3)}:brightness=${brightness.toFixed(3)}:saturation=${saturation.toFixed(3)}:gamma=${gamma.toFixed(3)}`
    );
  }

  if (!near(lut.temperature)) {
    const kelvin = Math.round(clamp(6500 - lut.temperature * 25, 1000, 12000));
    const mix = clamp(Math.abs(lut.temperature) / 100, 0, 1);
    filters.push(`colortemperature=temperature=${kelvin}:mix=${mix.toFixed(2)}`);
  }

  const tint = clamp(lut.tint / 100, -1, 1);
  const rs = clamp(lut.wheels.shadows.x * 0.4, -1, 1);
  const gs = clamp(lut.wheels.shadows.y * 0.4, -1, 1);
  const bs = clamp(-lut.wheels.shadows.x * 0.4, -1, 1);
  const rm = clamp(lut.wheels.midtones.x * 0.4 + tint * 0.15, -1, 1);
  const gm = clamp(lut.wheels.midtones.y * 0.4 - tint * 0.2, -1, 1);
  const bm = clamp(-lut.wheels.midtones.x * 0.4 + tint * 0.1, -1, 1);
  const rh = clamp(lut.wheels.highlights.x * 0.35, -1, 1);
  const gh = clamp(lut.wheels.highlights.y * 0.35, -1, 1);
  const bh = clamp(-lut.wheels.highlights.x * 0.35, -1, 1);
  if ([rs, gs, bs, rm, gm, bm, rh, gh, bh].some((v) => !near(v))) {
    filters.push(
      `colorbalance=rs=${rs.toFixed(3)}:gs=${gs.toFixed(3)}:bs=${bs.toFixed(3)}:rm=${rm.toFixed(3)}:gm=${gm.toFixed(3)}:bm=${bm.toFixed(3)}:rh=${rh.toFixed(3)}:gh=${gh.toFixed(3)}:bh=${bh.toFixed(3)}`
    );
  }

  const c = lut.curves;
  const curveParts: string[] = [];
  if (curveChanged(c.masterShadow, c.masterMidtone, c.masterHighlight)) {
    curveParts.push(`master='${curvePoints(c.masterShadow, c.masterMidtone, c.masterHighlight)}'`);
  }
  if (curveChanged(c.redShadow, c.redMidtone, c.redHighlight)) {
    curveParts.push(`r='${curvePoints(c.redShadow, c.redMidtone, c.redHighlight)}'`);
  }
  if (curveChanged(c.greenShadow, c.greenMidtone, c.greenHighlight)) {
    curveParts.push(`g='${curvePoints(c.greenShadow, c.greenMidtone, c.greenHighlight)}'`);
  }
  if (curveChanged(c.blueShadow, c.blueMidtone, c.blueHighlight)) {
    curveParts.push(`b='${curvePoints(c.blueShadow, c.blueMidtone, c.blueHighlight)}'`);
  }
  if (curveParts.length > 0) filters.push(`curves=${curveParts.join(':')}`);
  return filters;
}

/** Essential Sound → ffmpeg audio filters. Loudness is applied once at the end. */
export function audioProcessFilters(audio: ExportAudio, volume: number, rate: number): string[] {
  const filters: string[] = [];
  const tempo = atempoChain(rate);
  if (tempo) filters.push(tempo);
  if (audio.lowCut) filters.push('highpass=f=80');
  if (audio.noiseReduction > 0) {
    const nr = clamp(audio.noiseReduction / 5, 0.01, 20);
    filters.push(`afftdn=nr=${nr.toFixed(2)}:nf=-25`);
  }
  if (audio.deReverb > 0) {
    const nr = clamp(6 + audio.deReverb / 8, 6, 24);
    filters.push(`afftdn=nr=${nr.toFixed(2)}:nf=-40:tn=1`);
  }
  if (audio.clarity > 0) {
    const gain = (audio.clarity / 100) * 8;
    filters.push(`treble=g=${gain.toFixed(2)}:f=3500`);
  }
  if (audio.autoDuck) {
    filters.push('acompressor=threshold=-20dB:ratio=3:attack=15:release=200:makeup=2');
  }
  const wantsLoudnorm =
    audio.category === 'dialogue' || audio.category === 'music'
      ? audio.loudness !== 0 || audio.noiseReduction > 0 || audio.clarity > 0 || audio.deReverb > 0 || audio.lowCut || audio.autoDuck
      : false;
  if (wantsLoudnorm) {
    const base = audio.category === 'music' ? -14 : -16;
    const target = clamp(base + audio.loudness, -31, -5);
    filters.push(`loudnorm=I=${target.toFixed(1)}:TP=-1.5:LRA=11`);
  } else if (!near(audio.loudness)) {
    filters.push(`volume=${audio.loudness.toFixed(2)}dB`);
  }
  if (!near(volume, 1)) filters.push(`volume=${volume.toFixed(3)}`);
  return filters;
}

function scaleFilter(width: number, height: number, aspect: AutoReframeAspect): string {
  const fit = aspect === 'original' || aspect === '16:9' ? 'decrease' : 'increase';
  const scale = `scale=${width}:${height}:force_original_aspect_ratio=${fit}:flags=lanczos`;
  const fitFilter =
    fit === 'decrease'
      ? `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`
      : `crop=${width}:${height}`;
  return `${scale},${fitFilter},setsar=1`;
}

function edgeTransition(
  transition: VideoTransition,
  duration: number,
  width: number,
  height: number,
  fps: number
): string | null {
  if (transition === 'cut') return null;
  const fd = transitionDuration(duration);
  if (fd <= 0) return null;
  const d = sec(fd);
  const end = Math.max(0, duration - fd);
  const e = sec(end);
  if (transition === 'wipe') {
    return [
      `crop=w='trunc(if(lt(t\\,${d})\\,max(2\\,iw*t/${d})\\,if(gt(t\\,${e})\\,max(2\\,iw*(${sec(duration)}-t)/${d})\\,iw))/2)*2':h=ih:x=0:y=0`,
      `pad=${width}:${height}:0:0:black`,
    ].join(',');
  }
  if (transition === 'slide') {
    return [
      'pad=iw*2:ih:0:0:black',
      `crop=w=iw/2:h=ih:x='if(lt(t\\,${d})\\,(iw/2)*(1-t/${d})\\,if(gt(t\\,${e})\\,(iw/2)*((t-${e})/${d})\\,0))':y=0`,
    ].join(',');
  }
  if (transition === 'zoom') {
    // zoompan is used instead of scale=eval=frame, which aborts in the bundled ffmpeg.
    const z = `if(lte(time\\,${d})\\,1.35-0.35*time/${d}\\,if(gte(time\\,${e})\\,1+0.35*(time-${e})/${d}\\,1))`;
    return `zoompan=z='${z}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`;
  }
  const dip = transition === 'dip-to-black' ? Math.min(duration / 3, fd * 1.35) : fd;
  return `fade=t=in:st=0:d=${sec(dip)}:color=black,fade=t=out:st=${sec(Math.max(0, duration - dip))}:d=${sec(dip)}:color=black`;
}

function pixelFormat(format: ExportFormat): string {
  return format === 'mov' ? 'yuv422p10le' : 'yuv420p';
}

interface PictureExtras {
  lutCubePath?: string | null;
  fontFile?: string | null;
}

function mixTracks(job: ExportJob): { id: string; muted: boolean }[] {
  const ids = new Set<string>(['v1', 'a1']);
  for (const entry of job.creative?.trackMix ?? []) ids.add(entry.trackId);
  for (const clip of job.clips) {
    if (clip.trackId) ids.add(clip.trackId);
  }
  return [...ids].map((id) => ({
    id,
    muted: (id === 'a1' && job.audioTrackMuted) || (id === 'v1' && job.videoTrackMuted),
  }));
}

function deliveryCodec(job: ExportJob): DeliveryCodec {
  if (job.options.codec) return job.options.codec;
  if (job.options.format === 'webm') return 'vp9';
  if (job.options.format === 'mov') return 'prores';
  return 'h264';
}

function chosenEncoder(job: ExportJob): { codec: string; hardware: boolean; fallback: string } {
  return selectVideoEncoder({
    choice: job.options.encoder ?? 'software',
    available: job.options.availableEncoders ?? [],
    format: job.options.format,
    codec: deliveryCodec(job),
    platform: job.options.platform ?? 'linux',
  });
}

function videoBody(
  job: ExportJob,
  size: { width: number; height: number },
  rate: number,
  extras: PictureExtras = {},
  keyframes?: ExportKeyframe[],
  duration = 0,
): { chain: string; audioFilters: string[]; warnings: string[] } {
  const motion = motionGraph({
    keyframes,
    width: size.width,
    height: size.height,
    fps: job.options.frameRate,
    duration,
  });
  const pts = near(rate, 1, 0.001) ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${formatRate(rate)}`;
  const creativeFilters: string[] = [];
  if (job.creative) {
    const grade = liftGammaGainFilter(job.creative.liftGammaGain);
    if (grade) creativeFilters.push(grade);
    if (job.creative.lut && extras.lutCubePath) creativeFilters.push(lut3dFilter(extras.lutCubePath));
    for (const title of job.creative.titles) {
      creativeFilters.push(...drawtextFilters(title, size, job.trimStart, rate, extras.fontFile ?? null));
    }
  }
  return {
    chain: [
      pts,
      `fps=${job.options.frameRate}`,
      scaleFilter(size.width, size.height, job.autoReframe),
      ...motion.videoFilters,
      ...lumetriFilters(job.lumetri),
      ...creativeFilters,
      `format=${pixelFormat(job.options.format)}`,
    ].join(','),
    audioFilters: motion.audioFilters,
    warnings: motion.warnings,
  };
}

function audioBody(
  job: ExportJob,
  rate: number,
  clipId: string | null,
  duration: number,
  motionAudio: readonly string[] = [],
): string {
  if (!job.creative) {
    const process = audioProcessFilters(job.audio, job.volume, rate);
    return ['asetpts=PTS-STARTPTS', ...process, ...motionAudio].join(',');
  }
  const envelope = clipId ? clipEnvelope(job.creative, clipId) : job.creative.programAudio;
  const trackId = clipId
    ? (job.clips.find((clip) => clip.clipId === clipId)?.trackId ?? 'a1')
    : 'a1';
  const fader = trackFader(mixTracks(job), job.creative.trackMix, trackId);
  const mix = clamp(job.volume * fader * normalizeLinearGain(job.creative.loudness), 0, 4);
  const curve = hasGainCurve(envelope) ? volumeFilter(envelope, duration, mix) : null;
  const constant = curve ? 1 : clamp(mix * envelope.volume, 0, 4);
  const process = audioProcessFilters(job.audio, constant, rate);
  return ['asetpts=PTS-STARTPTS', ...process, curve, ...motionAudio].filter((part): part is string => Boolean(part)).join(',');
}

function codecArgs(job: ExportJob, withAudio: boolean): string[] {
  const { format, quality } = job.options;
  const crf = qualityToCrf(quality);
  const selected = chosenEncoder(job);
  const args = [...encoderArgs(selected.codec, crf, quality)];
  if (selected.codec === 'prores_ks') {
    const profileAt = args.indexOf('-profile:v');
    if (profileAt >= 0) args[profileAt + 1] = String(qualityToProresProfile(quality));
  }
  if (withAudio) {
    if (format === 'mov') args.push('-c:a', 'pcm_s16le');
    else args.push('-c:a', audioCodecName(format), '-b:a', audioBitrate(quality));
  }
  if (format === 'mp4') args.push('-movflags', '+faststart');
  if (withAudio) args.push('-ar', '48000');
  args.push('-r', String(job.options.frameRate));
  return args;
}

function videoCodecName(job: ExportJob): string {
  return chosenEncoder(job).codec || softwareCodecName(job.options.format, deliveryCodec(job));
}

function audioCodecName(format: ExportFormat): string {
  if (format === 'webm') return 'libopus';
  if (format === 'mov') return 'pcm_s16le';
  return 'aac';
}

function segmentDuration(ss: number, to: number, rate: number): number {
  return Math.max(0, (to - ss) / rate);
}

function collectWarnings(videos: MediaSegment[]): string[] {
  const warnings: string[] = [];
  const ordered = [...videos].sort((a, b) => a.timelineStart - b.timelineStart);
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const prevEnd = prev.timelineStart + prev.duration;
    if (ordered[i].timelineStart - prevEnd > 0.2) {
      warnings.push('Gaps between timeline clips are closed on export, so clips play back to back.');
      break;
    }
  }
  return warnings;
}

function validateRanges(job: ExportJob, outputPath: string): void {
  if (job.trimEnd <= job.trimStart + 0.05) {
    throw new ExportPlanError('The Out point must be at least 0.05 seconds after the In point. Wait for the video to finish loading, then set In and Out.');
  }
  if (pathsEqual(job.sourcePath, outputPath, true)) {
    throw new ExportPlanError('Choose a different file name. ffmpeg cannot overwrite the source video.');
  }
  for (const clip of job.clips) {
    if (pathsEqual(clip.sourcePath, outputPath, true)) {
      throw new ExportPlanError('Choose a different file name. A timeline clip uses the same path as the output.');
    }
  }
}

function buildSingle(
  job: ExportJob,
  outputPath: string,
  size: { width: number; height: number },
  duration: number,
  withAudio: boolean,
  warnings: string[],
  extras: PictureExtras,
): ExportPlan {
  const edge = edgeTransition(job.transition, duration, size.width, size.height, job.options.frameRate);
  const picture = videoBody(
    job,
    size,
    job.playbackRate,
    extras,
    prepareKeyframes(job.keyframes, job.trimStart, job.playbackRate),
    duration,
  );
  const chain = [picture.chain, edge].filter(Boolean).join(',');
  const args = [
    '-hide_banner', '-y', '-nostdin', '-progress', 'pipe:1', '-nostats',
    '-ss', sec(job.trimStart), '-to', sec(job.trimEnd), '-i', job.sourcePath,
  ];
  if (withAudio) {
    args.push('-filter_complex', `[0:v]${chain}[v];[0:a]${audioBody(job, job.playbackRate, null, duration, picture.audioFilters)}[a]`);
    args.push('-map', '[v]', '-map', '[a]');
  } else {
    args.push('-vf', chain, '-map', '0:v:0', '-an');
  }
  args.push(...codecArgs(job, withAudio), '-f', job.options.format, outputPath);
  return {
    args,
    outputPath,
    outputDurationSec: duration,
    width: size.width,
    height: size.height,
    frameRate: job.options.frameRate,
    format: job.options.format,
    videoCodec: videoCodecName(job),
    audioCodec: withAudio ? audioCodecName(job.options.format) : null,
    canRetryWithoutAudio: withAudio,
    warnings: [...warnings, ...picture.warnings],
  };
}

function buildBlack(
  job: ExportJob,
  outputPath: string,
  size: { width: number; height: number },
  duration: number,
  audioSource: { path: string; ss: number; to: number } | null,
  withAudio: boolean,
  warnings: string[],
): ExportPlan {
  const args = [
    '-hide_banner', '-y', '-nostdin', '-progress', 'pipe:1', '-nostats',
    '-f', 'lavfi', '-t', sec(duration), '-i', `color=c=black:s=${size.width}x${size.height}:r=${job.options.frameRate}`,
  ];
  const motion = motionGraph({
    keyframes: prepareKeyframes(job.keyframes, job.trimStart, job.playbackRate),
    width: size.width,
    height: size.height,
    fps: job.options.frameRate,
    duration,
  });
  if (withAudio && audioSource) {
    args.push('-ss', sec(audioSource.ss), '-to', sec(audioSource.to), '-i', audioSource.path);
    args.push('-filter_complex', `[1:a]${audioBody(job, job.playbackRate, null, duration, motion.audioFilters)}[a]`);
    args.push('-map', '0:v:0', '-map', '[a]', '-shortest');
  } else {
    args.push('-map', '0:v:0', '-an');
  }
  args.push(...codecArgs(job, withAudio && !!audioSource), '-f', job.options.format, outputPath);
  return {
    args,
    outputPath,
    outputDurationSec: duration,
    width: size.width,
    height: size.height,
    frameRate: job.options.frameRate,
    format: job.options.format,
    videoCodec: videoCodecName(job),
    audioCodec: withAudio && audioSource ? audioCodecName(job.options.format) : null,
    canRetryWithoutAudio: false,
    warnings: [...warnings, ...motion.warnings],
  };
}

function buildSequence(
  job: ExportJob,
  outputPath: string,
  size: { width: number; height: number },
  videos: MediaSegment[],
  externalAudio: MediaSegment[],
  withAudio: boolean,
  primaryAudio: boolean,
  warnings: string[],
  extras: PictureExtras,
): ExportPlan {
  const args = ['-hide_banner', '-y', '-nostdin', '-progress', 'pipe:1', '-nostats'];
  const media = [...videos, ...(withAudio ? externalAudio : [])];
  for (const seg of media) {
    args.push('-ss', sec(seg.ss), '-to', sec(seg.to), '-i', seg.sourcePath);
  }
  const chains: string[] = [];
  const motionWarnings: string[] = [];
  videos.forEach((seg, index) => {
    const picture = videoBody(job, size, job.playbackRate, extras, seg.keyframes, seg.duration);
    motionWarnings.push(...picture.warnings);
    chains.push(`[${index}:v]${picture.chain}[v${index}]`);
    if (!withAudio) return;
    if (seg.role === 'primary-video' && !primaryAudio) {
      chains.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=end=${sec(seg.duration)}[a${index}]`);
    } else {
      const audioClipId = seg.role === 'primary-video' ? null : seg.clipId ?? null;
      chains.push(`[${index}:a]${audioBody(job, job.playbackRate, audioClipId, seg.duration, picture.audioFilters)}[a${index}]`);
    }
  });

  let videoLabel = 'v0';
  let audioLabel = 'a0';
  let timeline = videos[0].duration;
  const hasClipTransitions = (job.creative?.transitions.length ?? 0) > 0;
  if (videos.length > 1 && job.transition === 'cut' && !hasClipTransitions) {
    if (withAudio) {
      const pairs = videos.map((_, i) => `[v${i}][a${i}]`).join('');
      chains.push(`${pairs}concat=n=${videos.length}:v=1:a=1[vx][ax]`);
      videoLabel = 'vx';
      audioLabel = 'ax';
    } else {
      const labels = videos.map((_, i) => `[v${i}]`).join('');
      chains.push(`${labels}concat=n=${videos.length}:v=1:a=0[vx]`);
      videoLabel = 'vx';
    }
    timeline = videos.reduce((sum, seg) => sum + seg.duration, 0);
  } else if (videos.length > 1) {
    const nameDefault = job.transition === 'cut' ? null : XFADE[job.transition as Exclude<VideoTransition, 'cut'>];
    for (let i = 1; i < videos.length; i += 1) {
      const left = videos[i - 1];
      const right = videos[i];
      const match = (job.creative?.transitions ?? []).find((item) =>
        Boolean(left.clipId) && item.outgoingClipId === left.clipId && item.incomingClipId === right.clipId);
      const fallbackFd = Math.min(transitionDuration(left.duration), right.duration / 2, left.duration / 2);
      let name = match ? xfadeName(match.kind) : nameDefault;
      let fd = match ? Math.min(match.duration, right.duration / 2, left.duration / 2) : fallbackFd;
      if (!name) {
        name = 'fade';
        fd = Math.min(0.04, right.duration / 2, left.duration / 2);
      }
      const offset = Math.max(0, timeline - fd);
      const vOut = `vx${i}`;
      chains.push(`[${videoLabel}][v${i}]xfade=transition=${name}:duration=${sec(fd)}:offset=${sec(offset)}[${vOut}]`);
      videoLabel = vOut;
      if (withAudio) {
        const aOut = `ax${i}`;
        chains.push(`[${audioLabel}][a${i}]acrossfade=d=${sec(fd)}:c1=tri:c2=tri[${aOut}]`);
        audioLabel = aOut;
      }
      timeline = timeline + videos[i].duration - fd;
    }
    const edge = edgeTransition(job.transition, timeline, size.width, size.height, job.options.frameRate);
    if (edge) {
      chains.push(`[${videoLabel}]${edge}[vout]`);
      videoLabel = 'vout';
    }
  } else {
    const edge = edgeTransition(job.transition, timeline, size.width, size.height, job.options.frameRate);
    if (edge) {
      chains.push(`[v0]${edge}[vx]`);
      videoLabel = 'vx';
    }
  }

  if (withAudio && externalAudio.length > 0) {
    externalAudio.forEach((clip, offset) => {
      const index = videos.length + offset;
      const motion = motionGraph({
        keyframes: clip.keyframes,
        width: size.width,
        height: size.height,
        fps: job.options.frameRate,
        duration: clip.duration,
      });
      motionWarnings.push(...motion.warnings);
      chains.push(`[${index}:a]${audioBody(job, job.playbackRate, clip.clipId ?? null, clip.duration, motion.audioFilters)}[mx${offset}]`);
      const mixed = `am${offset}`;
      if (job.audio.autoDuck) {
        chains.push(`[mx${offset}][${audioLabel}]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=250[duck${offset}]`);
        chains.push(`[${audioLabel}][duck${offset}]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[${mixed}]`);
      } else {
        chains.push(`[${audioLabel}][mx${offset}]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[${mixed}]`);
      }
      audioLabel = mixed;
    });
  }

  args.push('-filter_complex', chains.join(';'));
  args.push('-map', `[${videoLabel}]`);
  if (withAudio) args.push('-map', `[${audioLabel}]`);
  else args.push('-an');
  args.push(...codecArgs(job, withAudio), '-f', job.options.format, outputPath);

  return {
    args,
    outputPath,
    outputDurationSec: timeline,
    width: size.width,
    height: size.height,
    frameRate: job.options.frameRate,
    format: job.options.format,
    videoCodec: videoCodecName(job),
    audioCodec: withAudio ? audioCodecName(job.options.format) : null,
    canRetryWithoutAudio: withAudio && externalAudio.length === 0,
    warnings: [...warnings, ...motionWarnings],
  };
}

/**
 * Build the ffmpeg argument vector for an edit.
 * Throws ExportPlanError with a message safe to show in the export dialog.
 */
export function buildExportPlan(job: ExportJob, options: BuildOptions = {}): ExportPlan {
  const outputPath = ensureExtension(job.outputPath, job.options.format);
  validateRanges(job, outputPath);
  const includeAudio = options.includeAudio !== false;
  const masterSilent = job.muted || job.volume <= 0;
  const programFader = job.creative ? trackFader(mixTracks(job), job.creative.trackMix, 'a1') : 1;
  const primaryAudio = includeAudio && !masterSilent && !job.audioTrackMuted && programFader > 0;
  const extras: PictureExtras = { lutCubePath: options.lutCubePath, fontFile: options.fontFile };
  const size = outputSize(job.options.resolution, job.autoReframe);
  const rate = job.playbackRate;
  const primaryDuration = segmentDuration(job.trimStart, job.trimEnd, rate);

  const videoClips: MediaSegment[] = job.clips
    .filter((clip) => clip.trackType === 'video')
    .map((clip) => ({
      sourcePath: clip.sourcePath,
      ss: clip.inPoint,
      to: clip.outPoint,
      timelineStart: clip.startTime,
      duration: segmentDuration(clip.inPoint, clip.outPoint, rate),
      role: 'video-clip' as const,
      clipId: clip.clipId,
      trackId: clip.trackId,
      keyframes: prepareKeyframes(clip.keyframes, 0, rate),
    }))
    .sort((a, b) => a.timelineStart - b.timelineStart);

  const externalAudio: MediaSegment[] = masterSilent || !includeAudio
    ? []
    : job.clips
        .filter((clip) => clip.trackType === 'audio')
        .map((clip) => ({
          sourcePath: clip.sourcePath,
          ss: clip.inPoint,
          to: clip.outPoint,
          timelineStart: clip.startTime,
          duration: segmentDuration(clip.inPoint, clip.outPoint, rate),
          role: 'audio-clip' as const,
          clipId: clip.clipId,
          trackId: clip.trackId,
          keyframes: prepareKeyframes(clip.keyframes, 0, rate),
        }));

  const videos: MediaSegment[] = [];
  if (!job.videoTrackMuted) {
    videos.push({
      sourcePath: job.sourcePath,
      ss: job.trimStart,
      to: job.trimEnd,
      timelineStart: 0,
      duration: primaryDuration,
      role: 'primary-video',
      clipId: 'program',
      keyframes: prepareKeyframes(job.keyframes, job.trimStart, rate),
    });
  }
  videos.push(...videoClips);

  const warnings = collectWarnings(videos);
  if (job.creative?.lut && !options.lutCubePath) {
    warnings.push('The imported LUT is written beside the encode and applied with lut3d.');
  }
  const anyAudio = primaryAudio || externalAudio.length > 0;
  if (videos.length === 0 && !anyAudio) {
    throw new ExportPlanError('All tracks are muted. Unmute a video or audio track before exporting.');
  }

  if (videos.length === 0) {
    const audioSource = primaryAudio
      ? { path: job.sourcePath, ss: job.trimStart, to: job.trimEnd }
      : externalAudio[0]
        ? { path: externalAudio[0].sourcePath, ss: externalAudio[0].ss, to: externalAudio[0].to }
        : null;
    return buildBlack(job, outputPath, size, primaryDuration, audioSource, anyAudio, warnings);
  }

  const simple =
    videos.length === 1 &&
    videos[0].role === 'primary-video' &&
    externalAudio.length === 0;

  if (simple) {
    return buildSingle(job, outputPath, size, primaryDuration, primaryAudio, warnings, extras);
  }

  return buildSequence(job, outputPath, size, videos, externalAudio, anyAudio, primaryAudio, warnings, extras);
}
