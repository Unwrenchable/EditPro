/**
 * Proxy plans for timeline playback.
 *
 * The program monitor used to point a `<video>` element at the camera file.
 * 4K and phone HEVC are long-GOP, so Chromium software-decodes them, `timeupdate`
 * only ticks a few times a second, and scrubbing waits on the previous keyframe.
 *
 * A proxy is a short, all-intra H.264 mezzanine. Hardware decoders take H.264
 * everywhere, and a keyframe on every frame makes `currentTime` land on that
 * frame. Export never reads these files.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isMissingAudioError, parseClockSeconds } from '../export/plan.js';
import { canonicalizePath, isPathInside } from '../security.js';

export const PROXY_FORMAT_VERSION = 'proxy-avc-intra-v1';

export type PlaybackScale = 'full' | 'half' | 'quarter';

export interface MediaProbe {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  hasAudio: boolean;
}

export interface ProxySidecar {
  version: string;
  sourcePath: string;
  scale: PlaybackScale;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  videoCodec: string;
}

const PLAYBACK_SCALES: readonly PlaybackScale[] = ['full', 'half', 'quarter'];

export function isPlaybackScale(value: unknown): value is PlaybackScale {
  return typeof value === 'string' && (PLAYBACK_SCALES as readonly string[]).includes(value);
}

export function parseProxyRequest(payload: unknown): { sourcePath: string; scale: PlaybackScale } {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid proxy request');
  }
  const source = payload as { sourcePath?: unknown; scale?: unknown };
  if (typeof source.sourcePath !== 'string' || source.sourcePath.length === 0 || source.sourcePath.length > 4096) {
    throw new Error('Invalid proxy request');
  }
  if (!isPlaybackScale(source.scale)) {
    throw new Error('Invalid playback resolution');
  }
  return { sourcePath: source.sourcePath, scale: source.scale };
}

/** Longest edge of the proxy. Full is capped at 1080p-class so 4K is never decoded at 4K. */
export function proxyLongEdge(scale: PlaybackScale): number {
  if (scale === 'full') return 1920;
  if (scale === 'half') return 960;
  return 480;
}

export function evenDimension(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

export function proxyDimensions(
  sourceWidth: number,
  sourceHeight: number,
  scale: PlaybackScale,
): { width: number; height: number } {
  if (!(sourceWidth >= 2) || !(sourceHeight >= 2)) {
    throw new Error('The video frame size could not be read');
  }
  const longEdge = Math.max(sourceWidth, sourceHeight);
  const factor = Math.min(1, proxyLongEdge(scale) / longEdge);
  return {
    width: evenDimension(sourceWidth * factor),
    height: evenDimension(sourceHeight * factor),
  };
}

/** Stable CFR token so frame N sits at N/fps in the proxy. */
export function ffmpegFrameRate(fps: number): string {
  const known: Array<[number, string]> = [
    [23.976, '24000/1001'],
    [24, '24'],
    [25, '25'],
    [29.97, '30000/1001'],
    [30, '30'],
    [50, '50'],
    [59.94, '60000/1001'],
    [60, '60'],
  ];
  for (const [value, token] of known) {
    if (Math.abs(fps - value) < 0.02) return token;
  }
  const rounded = Math.round(fps * 1000) / 1000;
  if (!Number.isFinite(rounded) || rounded < 1 || rounded > 480) return '30';
  return String(rounded);
}

export function isHwaccelError(stderr: string): boolean {
  return /hwaccel|hardware acceleration|device creation failed|no (?:such )?device|vaapi|videotoolbox|d3d11va|cuvid|amf init|qsv/i.test(
    stderr,
  );
}

export function buildProxyArgs(options: {
  inputPath: string;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  hwaccel: boolean;
  includeAudio: boolean;
}): string[] {
  const args = ['-hide_banner', '-y'];
  if (options.hwaccel) args.push('-hwaccel', 'auto');
  args.push('-i', options.inputPath, '-map', '0:v:0');
  if (options.includeAudio) args.push('-map', '0:a:0?');
  args.push(
    '-vf',
    `scale=${options.width}:${options.height}:flags=bicubic`,
    '-fps_mode',
    'cfr',
    '-r',
    ffmpegFrameRate(options.fps),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-g',
    '1',
    '-keyint_min',
    '1',
    '-bf',
    '0',
    '-sc_threshold',
    '0',
    '-tag:v',
    'avc1',
  );
  if (options.includeAudio) {
    args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2');
  } else {
    args.push('-an');
  }
  args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', options.outputPath);
  return args;
}

export function parseMediaProbe(stderr: string): MediaProbe | null {
  const durationMatch = /Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(stderr);
  const streamMatch =
    /Video:\s*([a-zA-Z0-9]+)[^,\n]*,[^\n]*?(\d{2,5})x(\d{2,5})[^\n]*?(\d+(?:\.\d+)?)\s*fps/.exec(stderr);
  if (!durationMatch || !streamMatch) return null;
  const durationSec = parseClockSeconds(durationMatch[1]);
  const width = Number(streamMatch[2]);
  const height = Number(streamMatch[3]);
  const fps = Number(streamMatch[4]);
  if (durationSec === null || durationSec <= 0) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return null;
  if (!Number.isFinite(fps) || fps < 1 || fps > 480) return null;
  return {
    durationSec,
    width,
    height,
    fps,
    videoCodec: streamMatch[1].toLowerCase(),
    hasAudio: /Audio:/.test(stderr),
  };
}

export function proxyCacheFileName(identity: {
  sourcePath: string;
  size: number;
  mtimeMs: number;
  scale: PlaybackScale;
}): string {
  const hash = createHash('sha256')
    .update(PROXY_FORMAT_VERSION)
    .update('\0')
    .update(identity.sourcePath)
    .update('\0')
    .update(String(identity.size))
    .update('\0')
    .update(String(Math.round(identity.mtimeMs)))
    .update('\0')
    .update(identity.scale)
    .digest('hex');
  return hash;
}

export function proxyOutputPaths(cacheRoot: string, fileName: string): {
  finalPath: string;
  partialPath: string;
  sidecarPath: string;
} {
  if (!/^[a-f0-9]{64}$/.test(fileName)) {
    throw new Error('Invalid proxy cache name');
  }
  return {
    finalPath: path.join(cacheRoot, `${fileName}.mp4`),
    partialPath: path.join(cacheRoot, `${fileName}.part.mp4`),
    sidecarPath: path.join(cacheRoot, `${fileName}.json`),
  };
}

export function serializeProxySidecar(sidecar: ProxySidecar): string {
  return JSON.stringify(sidecar);
}

export function parseProxySidecar(raw: string): ProxySidecar | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Partial<ProxySidecar>;
  if (record.version !== PROXY_FORMAT_VERSION) return null;
  if (typeof record.sourcePath !== 'string' || record.sourcePath.length === 0) return null;
  if (!isPlaybackScale(record.scale)) return null;
  if (!isPositive(record.width) || !isPositive(record.height) || !isPositive(record.fps) || !isPositive(record.durationSec)) {
    return null;
  }
  if (typeof record.videoCodec !== 'string' || record.videoCodec.length === 0) return null;
  return {
    version: record.version,
    sourcePath: record.sourcePath,
    scale: record.scale,
    width: record.width,
    height: record.height,
    fps: record.fps,
    durationSec: record.durationSec,
    videoCodec: record.videoCodec,
  };
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function isInsideProxyCache(proxyRoot: string, filePath: string): boolean {
  try {
    return isPathInside(proxyRoot, canonicalizePath(filePath));
  } catch {
    return false;
  }
}

/** Export and proxy generation must read the camera original, never a proxy. */
export function assertExportSourceAllowed(filePath: string, proxyRoot: string, granted: boolean): void {
  if (isInsideProxyCache(proxyRoot, filePath)) {
    throw new Error('Export uses the original media. Proxies cannot be encoded as the master.');
  }
  if (!granted) {
    throw new Error('Refusing to read a video that was not opened in EditPro');
  }
}

export function canReadProxyFile(info: { isFile: boolean; isSymbolicLink: boolean }): boolean {
  return info.isFile && !info.isSymbolicLink;
}

export function explainProxyFailure(stderr: string): string {
  if (/no space left on device/i.test(stderr)) return 'Proxy generation failed: the disk is full.';
  if (/permission denied/i.test(stderr)) return 'Proxy generation failed: EditPro could not write the proxy cache.';
  if (/invalid data found|moov atom not found|error while decoding/i.test(stderr)) {
    return 'Proxy generation failed: this file could not be decoded.';
  }
  return 'Proxy generation failed. Playback will keep using the original.';
}

export function nextProxyAttempt(options: {
  hwaccel: boolean;
  includeAudio: boolean;
  stderr: string;
}): { hwaccel: boolean; includeAudio: boolean } | null {
  if (options.hwaccel && isHwaccelError(options.stderr)) {
    return { hwaccel: false, includeAudio: options.includeAudio };
  }
  if (options.includeAudio && isMissingAudioError(options.stderr)) {
    return { hwaccel: false, includeAudio: false };
  }
  return null;
}
