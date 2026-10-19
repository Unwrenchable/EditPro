/**
 * Whisper.cpp JSON, SRT, and VTT. Pure functions — the CLI is invoked elsewhere.
 */
export interface TranscriptWord {
  id: string;
  text: string;
  start: number;
  end: number;
}

export interface CaptionCue {
  id: string;
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}

const SPECIAL = /^(?:\[.*\]|<\|.*\|>)$/;

export function parseClock(value: string): number | null {
  const match = /^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4].padEnd(3, '0');
  return hours * 3600 + minutes * 60 + seconds + Number(fraction) / 1000;
}

function secondsFromToken(record: Record<string, unknown>): { start: number; end: number } | null {
  const offsets = record.offsets;
  if (offsets && typeof offsets === 'object') {
    const from = (offsets as { from?: unknown }).from;
    const to = (offsets as { to?: unknown }).to;
    if (typeof from === 'number' && typeof to === 'number') {
      return { start: from / 1000, end: to / 1000 };
    }
  }
  const timestamps = record.timestamps;
  if (timestamps && typeof timestamps === 'object') {
    const from = (timestamps as { from?: unknown }).from;
    const to = (timestamps as { to?: unknown }).to;
    if (typeof from === 'string' && typeof to === 'string') {
      const start = parseClock(from);
      const end = parseClock(to);
      if (start != null && end != null) return { start, end };
    }
  }
  return null;
}

function cleanToken(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function wordsFromTokens(
  tokens: unknown,
  cueStart: number,
  cueEnd: number,
  idPrefix: string,
): TranscriptWord[] {
  if (!Array.isArray(tokens)) return [];
  const words: TranscriptWord[] = [];
  let pending = '';
  let start = cueStart;
  let end = cueStart;
  const flush = () => {
    const text = cleanToken(pending);
    if (!text || SPECIAL.test(text)) {
      pending = '';
      return;
    }
    words.push({
      id: `${idPrefix}w${words.length + 1}`,
      text,
      start,
      end: Math.max(end, start + 0.01),
    });
    pending = '';
  };
  for (const token of tokens) {
    if (!token || typeof token !== 'object') continue;
    const record = token as Record<string, unknown>;
    const raw = typeof record.text === 'string' ? record.text : '';
    if (!raw || SPECIAL.test(raw.trim())) continue;
    const times = secondsFromToken(record);
    const startsWord = /^\s/.test(raw) || pending.length === 0;
    if (startsWord && pending.length > 0) flush();
    if (pending.length === 0) {
      start = times?.start ?? end;
      end = times?.end ?? start;
    } else if (times) {
      end = times.end;
    }
    pending += raw;
    if (times) end = Math.max(end, times.end);
  }
  flush();
  return words;
}

function wordsFromText(text: string, start: number, end: number, idPrefix: string): TranscriptWord[] {
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  const span = Math.max(0.01, end - start);
  return parts.map((part, index) => ({
    id: `${idPrefix}w${index + 1}`,
    text: part,
    start: start + (span * index) / parts.length,
    end: start + (span * (index + 1)) / parts.length,
  }));
}

export function parseWhisperJson(payload: unknown): CaptionCue[] {
  const root = payload && typeof payload === 'object' ? payload as { transcription?: unknown } : null;
  const segments = Array.isArray(root?.transcription) ? root.transcription : [];
  const cues: CaptionCue[] = [];
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') continue;
    const record = segment as Record<string, unknown>;
    const times = secondsFromToken(record);
    if (!times) continue;
    const text = cleanToken(typeof record.text === 'string' ? record.text : '');
    if (!text) continue;
    const id = `c${cues.length + 1}`;
    const tokenWords = wordsFromTokens(record.tokens, times.start, times.end, id);
    const words = tokenWords.length > 0 ? tokenWords : wordsFromText(text, times.start, times.end, id);
    cues.push({
      id,
      start: times.start,
      end: Math.max(times.end, times.start + 0.01),
      text,
      words,
    });
  }
  return cues;
}

function stamp(seconds: number, separator: ',' | '.'): string {
  const safe = Math.max(0, seconds);
  const whole = Math.floor(safe);
  const millis = Math.round((safe - whole) * 1000);
  const carried = millis === 1000 ? whole + 1 : whole;
  const ms = millis === 1000 ? 0 : millis;
  const hours = Math.floor(carried / 3600);
  const minutes = Math.floor((carried % 3600) / 60);
  const secs = carried % 60;
  const pad = (value: number, width = 2) => value.toString().padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(ms, 3)}`;
}

export function formatSrt(cues: readonly CaptionCue[]): string {
  return cues.map((cue, index) => (
    `${index + 1}\n${stamp(cue.start, ',')} --> ${stamp(cue.end, ',')}\n${cue.text}\n`
  )).join('\n');
}

export function formatVtt(cues: readonly CaptionCue[]): string {
  const body = cues.map((cue) => (
    `${stamp(cue.start, '.')} --> ${stamp(cue.end, '.')}\n${cue.text}\n`
  )).join('\n');
  return `WEBVTT\n\n${body}`;
}

/** ffmpeg `subtitles` filter path. Colons and quotes are escaped for the filtergraph. */
export function subtitlesFilter(srtPath: string): string {
  const escaped = srtPath
    .replaceAll('\\', '/')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'");
  return `subtitles='${escaped}'`;
}

export function burnInArgs(input: string, srtPath: string, output: string): string[] {
  return [
    '-y',
    '-hide_banner',
    '-i',
    input,
    '-vf',
    subtitlesFilter(srtPath),
    '-c:a',
    'copy',
    output,
  ];
}

export function whisperCliArgs(options: {
  modelPath: string;
  wavPath: string;
  outputBase: string;
  language: string;
  threads: number;
}): string[] {
  const language = /^[a-z]{2}$/.test(options.language) ? options.language : 'en';
  const threads = Math.max(1, Math.min(16, Math.round(options.threads)));
  return [
    '-m', options.modelPath,
    '-f', options.wavPath,
    '-ojf',
    '-of', options.outputBase,
    '-l', language,
    '-t', String(threads),
    '--no-gpu',
    '-np',
  ];
}
