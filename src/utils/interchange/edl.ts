import type { InterchangeClip, InterchangeSequence } from './model';
import { createSequence, quantizeClip, sortedClips } from './model';
import { fileUrlToPath, mediaStem } from './paths';
import { secondsToTimecode, supportsDropFrame, timecodeToSeconds } from './timecode';

const EVENT_PATTERN = /^(\d+)\s+(\S+)\s+(V\d*|A\d*|AA|B)\s+([A-Za-z])(?:\s+(\d{2,4}))?\s+(\d{2,}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2,}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2,}:\d{2}:\d{2}[:;]\d{2})\s+(\d{2,}:\d{2}:\d{2}[:;]\d{2})\s*$/i;

interface PendingEvent {
  reel: string;
  track: string;
  sourceIn: string;
  sourceOut: string;
  recordIn: string;
  recordOut: string;
  name: string;
  path: string;
}

function trackCode(trackName: string, trackType: InterchangeClip['trackType']): string {
  const match = /(\d+)\s*$/.exec(trackName.trim());
  const index = match ? Number(match[1]) : 1;
  if (trackType === 'video') return index <= 1 ? 'V' : `V${index}`;
  return index <= 1 ? 'A' : `A${index}`;
}

function reelOf(clip: InterchangeClip): string {
  const cleaned = mediaStem(clip.name || clip.path).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (cleaned || 'AX').slice(0, 8).padEnd(8, ' ');
}

function commentValue(line: string, label: string): string | null {
  const match = new RegExp(`^\\*\\s*${label}\\s*:\\s*(.*)$`, 'i').exec(line.trim());
  return match ? match[1].trim() : null;
}

function tracksFor(code: string): { trackName: string; trackType: InterchangeClip['trackType'] }[] {
  const token = code.toUpperCase();
  if (token === 'AA') {
    return [
      { trackName: 'A1', trackType: 'audio' },
      { trackName: 'A2', trackType: 'audio' },
    ];
  }
  if (token === 'B') {
    return [
      { trackName: 'V1', trackType: 'video' },
      { trackName: 'A1', trackType: 'audio' },
    ];
  }
  if (token.startsWith('V')) {
    const index = Number(token.slice(1)) || 1;
    return [{ trackName: `V${index}`, trackType: 'video' }];
  }
  const index = Number(token.slice(1)) || 1;
  return [{ trackName: `A${index}`, trackType: 'audio' }];
}

function pushEvent(
  sequence: InterchangeSequence,
  event: PendingEvent,
  ordinal: number,
): void {
  const drop = sequence.dropFrame;
  const rate = sequence.frameRate;
  const start = timecodeToSeconds(event.recordIn, rate, drop);
  const end = timecodeToSeconds(event.recordOut, rate, drop);
  const inPoint = timecodeToSeconds(event.sourceIn, rate, drop);
  const outPoint = timecodeToSeconds(event.sourceOut, rate, drop);
  const path = event.path || event.name || event.reel.trim() || `reel-${ordinal}`;
  const name = event.name || event.reel.trim() || path;
  tracksFor(event.track).forEach((track, index) => {
    sequence.clips.push(quantizeClip({
      id: `edl-${ordinal}${index === 0 ? '' : `-${track.trackName}`}`,
      name,
      path,
      trackName: track.trackName,
      trackType: track.trackType,
      start,
      end,
      inPoint,
      outPoint,
    }, rate));
  });
}

/** Read a CMX 3600 edit decision list. Frame rate is not stored in the file. */
export function importEdl(text: string, frameRate = 24): InterchangeSequence {
  let name = 'Sequence';
  let dropFrame = false;
  const events: PendingEvent[] = [];
  let current: PendingEvent | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const title = /^TITLE\s*:\s*(.*)$/i.exec(line);
    if (title) {
      name = title[1].trim() || name;
      continue;
    }
    const fcm = /^FCM\s*:\s*(.*)$/i.exec(line);
    if (fcm) {
      dropFrame = !/NON-DROP/i.test(fcm[1]) && /DROP/i.test(fcm[1]);
      continue;
    }
    const event = EVENT_PATTERN.exec(line);
    if (event) {
      if (current) events.push(current);
      current = {
        reel: event[2],
        track: event[3],
        sourceIn: event[6],
        sourceOut: event[7],
        recordIn: event[8],
        recordOut: event[9],
        name: '',
        path: '',
      };
      if (event[6].includes(';') || event[8].includes(';')) dropFrame = true;
      continue;
    }
    if (!current || !line.startsWith('*')) continue;
    const clipName = commentValue(line, 'FROM CLIP NAME');
    const source = commentValue(line, 'SOURCE FILE');
    if (clipName) current.name = clipName;
    if (source) current.path = fileUrlToPath(source);
  }
  if (current) events.push(current);
  const sequence = createSequence({
    name,
    frameRate,
    dropFrame: dropFrame && supportsDropFrame(frameRate),
  });
  events.forEach((event, index) => pushEvent(sequence, event, index + 1));
  sequence.clips = sortedClips(sequence.clips);
  return sequence;
}

/** Write a CMX 3600 list. Picture and sound events use cut transitions. */
export function exportEdl(sequence: InterchangeSequence): string {
  const drop = sequence.dropFrame && supportsDropFrame(sequence.frameRate);
  const lines = [
    `TITLE: ${sequence.name.replace(/[\r\n]+/g, ' ').trim() || 'Sequence'}`,
    `FCM: ${drop ? 'DROP FRAME' : 'NON-DROP FRAME'}`,
    '',
  ];
  sortedClips(sequence.clips).forEach((clip, index) => {
    const rate = sequence.frameRate;
    const sourceIn = secondsToTimecode(clip.inPoint, rate, drop);
    const sourceOut = secondsToTimecode(clip.outPoint, rate, drop);
    const recordIn = secondsToTimecode(clip.start, rate, drop);
    const recordOut = secondsToTimecode(clip.end, rate, drop);
    const number = String(index + 1).padStart(3, '0');
    const track = trackCode(clip.trackName, clip.trackType).padEnd(6, ' ');
    lines.push(`${number}  ${reelOf(clip)} ${track}C        ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`);
    lines.push(`* FROM CLIP NAME: ${clip.name.replace(/[\r\n]+/g, ' ')}`);
    lines.push(`* SOURCE FILE: ${clip.path.replace(/[\r\n]+/g, ' ')}`);
    lines.push('');
  });
  return `${lines.join('\n').trimEnd()}\n`;
}
