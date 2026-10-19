import type { InterchangeClip, InterchangeSequence } from './model';
import { createSequence, quantizeClip, sortedClips } from './model';
import { fileUrlToPath, mediaBaseName, pathToFileUrl } from './paths';
import { quantizeTime, resolveRate } from './timecode';
import { child, el, findAll, parseXml, serializeXml, type XmlNode } from './xml';

const TIMED = new Set([
  'asset-clip',
  'audition',
  'audio',
  'clip',
  'gap',
  'mc-clip',
  'ref-clip',
  'sync-clip',
  'title',
  'transition',
  'video',
]);

interface Asset {
  name: string;
  path: string;
  hasVideo: boolean;
  hasAudio: boolean;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

/** FCPXML time: `4s` or a rational `1001/30000s`. */
export function formatFcpxTime(seconds: number, frameRate: number): string {
  const rate = resolveRate(frameRate);
  const frames = Math.max(0, Math.round((Math.max(0, seconds) * rate.den) / rate.num));
  const numerator = frames * rate.num;
  const denominator = rate.den;
  const divisor = gcd(numerator, denominator);
  const num = numerator / divisor;
  const den = denominator / divisor;
  return den === 1 ? `${num}s` : `${num}/${den}s`;
}

export function parseFcpxTime(value: string | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim();
  const rational = /^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)s$/.exec(trimmed);
  if (rational) {
    const den = Number(rational[2]);
    return den === 0 ? 0 : Number(rational[1]) / den;
  }
  const whole = /^(-?\d+(?:\.\d+)?)s$/.exec(trimmed);
  if (whole) return Number(whole[1]);
  const bare = Number(trimmed);
  return Number.isFinite(bare) ? bare : 0;
}

function frameRateFromDuration(duration: string | undefined): number {
  const seconds = parseFcpxTime(duration);
  if (seconds <= 0) return 24;
  return resolveRate(1 / seconds).label;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value !== '0' && value.toLowerCase() !== 'false';
}

function assetsOf(root: XmlNode): Map<string, Asset> {
  const assets = new Map<string, Asset>();
  for (const node of findAll(root, 'asset')) {
    const id = node.attrs.id;
    if (!id) continue;
    const rep = node.children.find((item) => item.name === 'media-rep' && item.attrs.src);
    const src = node.attrs.src || rep?.attrs.src || '';
    assets.set(id, {
      name: node.attrs.name || mediaBaseName(src),
      path: src ? fileUrlToPath(src) : '',
      hasVideo: flag(node.attrs.hasVideo, true),
      hasAudio: flag(node.attrs.hasAudio, false),
    });
  }
  return assets;
}

function referenceOf(node: XmlNode): { ref?: string; src?: string } {
  if (node.attrs.ref || node.attrs.src) return { ref: node.attrs.ref, src: node.attrs.src };
  const inner = node.children.find((childNode) =>
    (childNode.name === 'video' || childNode.name === 'audio' || childNode.name === 'asset-clip')
    && (childNode.attrs.ref || childNode.attrs.src));
  return { ref: inner?.attrs.ref, src: inner?.attrs.src };
}

function shouldEmit(node: XmlNode, parentName: string): boolean {
  const ref = referenceOf(node);
  const hasMedia = Boolean(ref.ref || ref.src);
  if (!hasMedia) return false;
  if (node.name === 'asset-clip' || node.name === 'ref-clip' || node.name === 'clip') return true;
  return (node.name === 'audio' || node.name === 'video') && parentName === 'spine';
}

function pushFcpxClip(
  clips: InterchangeClip[],
  node: XmlNode,
  timelineStart: number,
  duration: number,
  assets: Map<string, Asset>,
  frameRate: number,
): void {
  const ref = referenceOf(node);
  const asset = ref.ref ? assets.get(ref.ref) : undefined;
  const path = asset?.path || (ref.src ? fileUrlToPath(ref.src) : '');
  const hasVideo = asset ? asset.hasVideo : node.name !== 'audio';
  const hasAudio = asset ? asset.hasAudio : node.name === 'audio';
  let lane = 0;
  if (node.attrs.lane !== undefined && node.attrs.lane !== '') lane = Number(node.attrs.lane) || 0;
  else if (node.name === 'audio' || (hasAudio && !hasVideo)) lane = -1;
  const track = lane < 0
    ? { trackName: `A${-lane}`, trackType: 'audio' as const }
    : { trackName: `V${lane + 1}`, trackType: 'video' as const };
  const sourceIn = parseFcpxTime(node.attrs.start);
  const name = node.attrs.name || asset?.name || mediaBaseName(path);
  clips.push(quantizeClip({
    id: `fcpx-${clips.length + 1}`,
    name,
    path: path || name,
    trackName: track.trackName,
    trackType: track.trackType,
    start: timelineStart,
    end: timelineStart + duration,
    inPoint: sourceIn,
    outPoint: sourceIn + duration,
  }, frameRate));
}

function walk(
  node: XmlNode,
  parentStart: number,
  spine: boolean,
  assets: Map<string, Asset>,
  clips: InterchangeClip[],
  frameRate: number,
): void {
  let cursor = 0;
  for (const childNode of node.children) {
    if (childNode.name === 'spine') {
      walk(childNode, parentStart, true, assets, clips, frameRate);
      continue;
    }
    if (!TIMED.has(childNode.name)) continue;
    const offset = childNode.attrs.offset !== undefined
      ? parseFcpxTime(childNode.attrs.offset)
      : (spine ? cursor : 0);
    const duration = parseFcpxTime(childNode.attrs.duration);
    const timelineStart = parentStart + offset;
    if (spine) cursor = offset + duration;
    if (shouldEmit(childNode, node.name)) {
      pushFcpxClip(clips, childNode, timelineStart, duration, assets, frameRate);
    }
    walk(childNode, timelineStart, false, assets, clips, frameRate);
  }
}

export function importFcpxml(text: string): InterchangeSequence {
  const root = parseXml(text);
  if (root.name !== 'fcpxml') throw new Error('Not an FCPXML document');
  const sequenceNode = findAll(root, 'sequence')[0];
  if (!sequenceNode) throw new Error('FCPXML has no sequence');
  const formatId = sequenceNode.attrs.format;
  const format = findAll(root, 'format').find((node) => node.attrs.id === formatId) ?? findAll(root, 'format')[0];
  const frameRate = frameRateFromDuration(format?.attrs.frameDuration);
  const project = findAll(root, 'project')[0];
  const sequence = createSequence({
    name: project?.attrs.name || sequenceNode.attrs.name || 'Sequence',
    frameRate,
    dropFrame: sequenceNode.attrs.tcFormat === 'DF' && (frameRate === 29.97 || frameRate === 59.94),
    width: Number(format?.attrs.width) || 1920,
    height: Number(format?.attrs.height) || 1080,
  });
  const spine = child(sequenceNode, 'spine') ?? findAll(sequenceNode, 'spine')[0];
  if (spine) walk(spine, 0, true, assetsOf(root), sequence.clips, sequence.frameRate);
  sequence.clips = sortedClips(sequence.clips);
  return sequence;
}

function laneOf(clip: InterchangeClip): string | null {
  const match = /(\d+)\s*$/.exec(clip.trackName.trim());
  const index = match ? Number(match[1]) : 1;
  if (clip.trackType === 'video') return index <= 1 ? null : String(index - 1);
  return String(-(index || 1));
}

export function exportFcpxml(sequence: InterchangeSequence): string {
  const rate = resolveRate(sequence.frameRate);
  const paths = new Map<string, { id: string; hasVideo: boolean; hasAudio: boolean; duration: number; name: string }>();
  for (const clip of sequence.clips) {
    const key = clip.path || clip.name;
    const existing = paths.get(key);
    const duration = Math.max(existing?.duration ?? 0, clip.outPoint);
    if (existing) {
      existing.hasVideo = existing.hasVideo || clip.trackType === 'video';
      existing.hasAudio = existing.hasAudio || clip.trackType === 'audio';
      existing.duration = duration;
    } else {
      paths.set(key, {
        id: `r${paths.size + 2}`,
        hasVideo: clip.trackType === 'video',
        hasAudio: clip.trackType === 'audio',
        duration,
        name: mediaBaseName(key),
      });
    }
  }
  const format = el('format', {
    id: 'r1',
    name: `FFVideoFormat${sequence.height}p${rate.nominal}`,
    frameDuration: `${rate.num}/${rate.den}s`,
    width: String(sequence.width),
    height: String(sequence.height),
  });
  const assets = [...paths.entries()].map(([path, asset]) => el('asset', {
    id: asset.id,
    name: asset.name,
    src: pathToFileUrl(path),
    start: '0s',
    duration: formatFcpxTime(Math.max(asset.duration, quantizeTime(1 / 24, sequence.frameRate)), sequence.frameRate),
    hasVideo: asset.hasVideo ? '1' : '0',
    hasAudio: asset.hasAudio ? '1' : '0',
    format: 'r1',
  }));
  const end = sequence.clips.reduce((max, clip) => Math.max(max, clip.end), 0);
  const spineClips = sortedClips(sequence.clips).map((clip) => {
    const asset = paths.get(clip.path || clip.name);
    const duration = Math.max(0, clip.end - clip.start);
    const attrs: Record<string, string> = {
      ref: asset?.id ?? 'r2',
      name: clip.name,
      offset: formatFcpxTime(clip.start, sequence.frameRate),
      start: formatFcpxTime(clip.inPoint, sequence.frameRate),
      duration: formatFcpxTime(duration, sequence.frameRate),
    };
    const lane = laneOf(clip);
    if (lane !== null) attrs.lane = lane;
    return el('asset-clip', attrs);
  });
  const document = el('fcpxml', { version: '1.9' }, [
    el('resources', {}, [format, ...assets]),
    el('library', {}, [
      el('event', { name: 'EditPro' }, [
        el('project', { name: sequence.name || 'Sequence' }, [
          el('sequence', {
            format: 'r1',
            duration: formatFcpxTime(end, sequence.frameRate),
            tcStart: '0s',
            tcFormat: sequence.dropFrame ? 'DF' : 'NDF',
          }, [
            el('spine', {}, spineClips),
          ]),
        ]),
      ]),
    ]),
  ]);
  return serializeXml(document);
}
