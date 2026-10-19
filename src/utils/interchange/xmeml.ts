import type { TrackType } from '../../types';
import type { InterchangeClip, InterchangeSequence } from './model';
import { createSequence, quantizeClip, sortedClips } from './model';
import { fileUrlToPath, mediaBaseName, pathToFileUrl } from './paths';
import { framesToSeconds, resolveRate, secondsToFrames } from './timecode';
import { child, childText, childrenNamed, el, findAll, parseXml, serializeXml, type XmlNode } from './xml';

interface MediaFile {
  path: string;
  name: string;
}

function ntscRate(timebase: number, ntsc: boolean): number {
  if (!ntsc) return timebase > 0 ? timebase : 24;
  if (timebase === 24) return 23.976;
  if (timebase === 30) return 29.97;
  if (timebase === 60) return 59.94;
  return timebase > 0 ? timebase : 24;
}

function rateNode(frameRate: number): XmlNode {
  const rate = resolveRate(frameRate);
  return el('rate', {}, [
    el('timebase', {}, String(rate.nominal)),
    el('ntsc', {}, rate.num === 1001 ? 'TRUE' : 'FALSE'),
  ]);
}

function readRate(node: XmlNode | undefined): { frameRate: number; dropFrame: boolean } {
  const rate = node ? child(node, 'rate') ?? node : undefined;
  const timebase = Number(rate ? childText(rate, 'timebase') : '') || 24;
  const ntsc = /^(TRUE|YES|1)$/i.test(rate ? childText(rate, 'ntsc') : '');
  const dropFrame = node
    ? findAll(node, 'displayformat').some((item) => item.text.toUpperCase() === 'DF')
    : false;
  const frameRate = ntscRate(timebase, ntsc);
  return {
    frameRate,
    dropFrame: dropFrame && (frameRate === 29.97 || frameRate === 59.94),
  };
}

function integerText(node: XmlNode, name: string): number | null {
  const text = childText(node, name).trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? Math.round(value) : null;
}

function collectFiles(sequenceNode: XmlNode): Map<string, MediaFile> {
  const files = new Map<string, MediaFile>();
  for (const file of findAll(sequenceNode, 'file')) {
    const id = file.attrs.id;
    const path = fileUrlToPath(childText(file, 'pathurl'));
    const name = childText(file, 'name');
    if (id && (path || name)) files.set(id, { path, name });
  }
  return files;
}

function fileOf(clipitem: XmlNode, files: Map<string, MediaFile>): MediaFile {
  const file = child(clipitem, 'file');
  if (!file) return { path: '', name: '' };
  const id = file.attrs.id ?? '';
  const path = fileUrlToPath(childText(file, 'pathurl'));
  const name = childText(file, 'name');
  if (path || name) return { path, name };
  return files.get(id) ?? { path: '', name: '' };
}

function readTracks(
  parent: XmlNode | undefined,
  trackType: TrackType,
  sequence: InterchangeSequence,
  files: Map<string, MediaFile>,
): void {
  if (!parent) return;
  childrenNamed(parent, 'track').forEach((track, trackIndex) => {
    const fallback = `${trackType === 'video' ? 'V' : 'A'}${trackIndex + 1}`;
    const trackName = childText(track, 'name').trim() || fallback;
    for (const clipitem of childrenNamed(track, 'clipitem')) {
      const startFrame = integerText(clipitem, 'start');
      const endFrame = integerText(clipitem, 'end');
      if (startFrame === null || endFrame === null || startFrame < 0 || endFrame <= startFrame) continue;
      const inFrame = integerText(clipitem, 'in') ?? 0;
      const outFrame = integerText(clipitem, 'out') ?? inFrame + (endFrame - startFrame);
      const media = fileOf(clipitem, files);
      const name = childText(clipitem, 'name').trim() || media.name || mediaBaseName(media.path);
      const path = media.path || name;
      const rate = sequence.frameRate;
      sequence.clips.push(quantizeClip({
        id: clipitem.attrs.id || `xmeml-${sequence.clips.length + 1}`,
        name,
        path,
        trackName,
        trackType,
        start: framesToSeconds(startFrame, rate),
        end: framesToSeconds(endFrame, rate),
        inPoint: framesToSeconds(Math.max(0, inFrame), rate),
        outPoint: framesToSeconds(Math.max(0, outFrame), rate),
      }, rate));
    }
  });
}

export function importXmeml(text: string): InterchangeSequence {
  const root = parseXml(text);
  const sequenceNode = root.name === 'sequence' ? root : findAll(root, 'sequence')[0];
  if (!sequenceNode) throw new Error('Premiere XML has no sequence');
  const timing = readRate(sequenceNode);
  const width = Number(childText(findAll(sequenceNode, 'samplecharacteristics')[0] ?? sequenceNode, 'width'));
  const height = Number(childText(findAll(sequenceNode, 'samplecharacteristics')[0] ?? sequenceNode, 'height'));
  const sequence = createSequence({
    name: childText(sequenceNode, 'name') || 'Sequence',
    frameRate: timing.frameRate,
    dropFrame: timing.dropFrame,
    width: Number.isFinite(width) && width > 0 ? width : 1920,
    height: Number.isFinite(height) && height > 0 ? height : 1080,
  });
  const files = collectFiles(sequenceNode);
  const media = child(sequenceNode, 'media');
  readTracks(child(media ?? sequenceNode, 'video'), 'video', sequence, files);
  readTracks(child(media ?? sequenceNode, 'audio'), 'audio', sequence, files);
  sequence.clips = sortedClips(sequence.clips);
  return sequence;
}

function clipItem(clip: InterchangeClip, fileId: string, frameRate: number): XmlNode {
  const start = secondsToFrames(clip.start, frameRate);
  let end = secondsToFrames(clip.end, frameRate);
  if (end <= start) end = start + 1;
  const inPoint = secondsToFrames(clip.inPoint, frameRate);
  let outPoint = secondsToFrames(clip.outPoint, frameRate);
  if (outPoint <= inPoint) outPoint = inPoint + (end - start);
  return el('clipitem', { id: clip.id || fileId }, [
    el('name', {}, clip.name),
    el('duration', {}, String(outPoint - inPoint)),
    rateNode(frameRate),
    el('start', {}, String(start)),
    el('end', {}, String(end)),
    el('in', {}, String(inPoint)),
    el('out', {}, String(outPoint)),
    el('file', { id: fileId }, [
      el('name', {}, mediaBaseName(clip.path || clip.name)),
      el('pathurl', {}, pathToFileUrl(clip.path || clip.name)),
      rateNode(frameRate),
    ]),
  ]);
}

export function exportXmeml(sequence: InterchangeSequence): string {
  const groups = new Map<string, { name: string; type: TrackType; clips: InterchangeClip[] }>();
  for (const clip of sortedClips(sequence.clips)) {
    const key = `${clip.trackType}:${clip.trackName}`;
    const group = groups.get(key);
    if (group) group.clips.push(clip);
    else groups.set(key, { name: clip.trackName, type: clip.trackType, clips: [clip] });
  }
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'video' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
  const videoTracks = ordered.filter((group) => group.type === 'video');
  const audioTracks = ordered.filter((group) => group.type === 'audio');
  const files = new Map<string, string>();
  const trackNode = (group: { name: string; clips: InterchangeClip[] }): XmlNode => el('track', {}, [
    el('name', {}, group.name),
    el('enabled', {}, 'TRUE'),
    el('locked', {}, 'FALSE'),
    ...group.clips.map((clip) => {
      const key = clip.path || clip.name;
      let fileId = files.get(key);
      if (!fileId) {
        fileId = `file-${files.size + 1}`;
        files.set(key, fileId);
      }
      return clipItem(clip, fileId, sequence.frameRate);
    }),
  ]);
  const endFrame = sequence.clips.reduce((max, clip) => Math.max(max, secondsToFrames(clip.end, sequence.frameRate)), 0);
  const characteristics = [
    rateNode(sequence.frameRate),
    el('width', {}, String(sequence.width)),
    el('height', {}, String(sequence.height)),
    el('pixelaspectratio', {}, 'square'),
  ];
  const document = el('xmeml', { version: '4' }, [
    el('sequence', {}, [
      el('name', {}, sequence.name || 'Sequence'),
      el('duration', {}, String(endFrame)),
      rateNode(sequence.frameRate),
      el('timecode', {}, [
        rateNode(sequence.frameRate),
        el('string', {}, '00:00:00:00'),
        el('frame', {}, '0'),
        el('displayformat', {}, sequence.dropFrame ? 'DF' : 'NDF'),
      ]),
      el('media', {}, [
        el('video', {}, [
          el('format', {}, [el('samplecharacteristics', {}, characteristics)]),
          ...(videoTracks.length > 0 ? videoTracks.map(trackNode) : [el('track')]),
        ]),
        el('audio', {}, audioTracks.length > 0 ? audioTracks.map(trackNode) : [el('track')]),
      ]),
    ]),
  ]);
  return serializeXml(document);
}
