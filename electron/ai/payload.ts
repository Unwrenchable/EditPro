/**
 * Renderer payloads for offline AI. Paths are checked again against file grants.
 */
import type { CaptionCue, TranscriptWord } from './captions/format.js';
import { whisperModel } from './catalog.js';

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseSourcePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0')) {
    throw new Error('Choose a video that was opened from disk');
  }
  return value;
}

function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} is out of range`);
  }
  return value;
}

export function parseTranscribeRequest(value: unknown): { sourcePath: string; modelId: string; language: string } {
  const body = record(value);
  if (!body) throw new Error('The transcribe request is invalid');
  const modelId = typeof body.modelId === 'string' ? body.modelId : 'tiny.en';
  whisperModel(modelId);
  const language = typeof body.language === 'string' && /^[a-z]{2}$/.test(body.language) ? body.language : 'en';
  return { sourcePath: parseSourcePath(body.sourcePath), modelId, language };
}

export function parseDownloadRequest(value: unknown): { kind: 'model' | 'cli' | 'matte'; modelId: string } {
  const body = record(value);
  if (!body) throw new Error('The download request is invalid');
  const kind = body.kind;
  if (kind !== 'model' && kind !== 'cli' && kind !== 'matte') throw new Error('Unknown download');
  const modelId = typeof body.modelId === 'string' ? body.modelId : 'tiny.en';
  if (kind === 'model') whisperModel(modelId);
  return { kind, modelId };
}

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Drop C0 controls except tab, LF, and CR. A character class would trip no-control-regex.
  let cleaned = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    const control = code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f);
    if (!control) cleaned += char;
  }
  return cleaned.trim().slice(0, 400);
}

function parseWord(value: unknown, cueId: string, index: number): TranscriptWord | null {
  const body = record(value);
  if (!body) return null;
  const text = cleanText(body.text);
  if (!text) return null;
  const start = finite(body.start, 'Word time', 0, 86400);
  const end = finite(body.end, 'Word time', 0, 86400);
  return {
    id: `${cueId}w${index + 1}`,
    text,
    start,
    end: Math.max(end, start + 0.01),
  };
}

export function parseCues(value: unknown): CaptionCue[] {
  if (!Array.isArray(value) || value.length > 5000) throw new Error('Too many captions');
  const cues: CaptionCue[] = [];
  for (const item of value) {
    const body = record(item);
    if (!body) throw new Error('A caption is invalid');
    const text = cleanText(body.text);
    if (!text) continue;
    const start = finite(body.start, 'Caption time', 0, 86400);
    const end = finite(body.end, 'Caption time', 0, 86400);
    const id = `c${cues.length + 1}`;
    const words = Array.isArray(body.words)
      ? body.words.map((word, index) => parseWord(word, id, index)).filter((word): word is TranscriptWord => word != null)
      : [];
    cues.push({
      id,
      start,
      end: Math.max(end, start + 0.01),
      text,
      words,
    });
  }
  return cues;
}

export function parseCaptionFormat(value: unknown): 'srt' | 'vtt' {
  return value === 'vtt' ? 'vtt' : 'srt';
}

export interface TimeRange {
  start: number;
  end: number;
}

export function parseRanges(value: unknown): TimeRange[] {
  if (!Array.isArray(value) || value.length > 5000) throw new Error('Too many cut ranges');
  return value.map((item) => {
    const body = record(item);
    if (!body) throw new Error('A cut range is invalid');
    const start = finite(body.start, 'Cut time', 0, 86400);
    const end = finite(body.end, 'Cut time', 0, 86400);
    if (end <= start) throw new Error('A cut range is invalid');
    return { start, end };
  });
}

export function parseSilenceRequest(value: unknown): {
  sourcePath: string;
  noiseDb: number;
  minDuration: number;
  padding: number;
} {
  const body = record(value);
  if (!body) throw new Error('The silence request is invalid');
  return {
    sourcePath: parseSourcePath(body.sourcePath),
    noiseDb: finite(typeof body.noiseDb === 'number' ? body.noiseDb : -35, 'Noise threshold', -60, -15),
    minDuration: finite(typeof body.minDuration === 'number' ? body.minDuration : 0.45, 'Minimum silence', 0.1, 5),
    padding: finite(typeof body.padding === 'number' ? body.padding : 0.08, 'Padding', 0, 0.5),
  };
}

export function parseSceneRequest(value: unknown): { sourcePath: string; threshold: number } {
  const body = record(value);
  if (!body) throw new Error('The scene request is invalid');
  return {
    sourcePath: parseSourcePath(body.sourcePath),
    threshold: finite(typeof body.threshold === 'number' ? body.threshold : 0.3, 'Scene threshold', 0.05, 0.9),
  };
}

export function parseBackgroundRequest(value: unknown): {
  sourcePath: string;
  mode: 'transparent' | 'color';
  color: string;
} {
  const body = record(value);
  if (!body) throw new Error('The background request is invalid');
  const mode = body.mode === 'color' ? 'color' : 'transparent';
  const color = typeof body.color === 'string' ? body.color : '00ff00';
  return { sourcePath: parseSourcePath(body.sourcePath), mode, color };
}

export function parseCutRequest(value: unknown): { sourcePath: string; ranges: TimeRange[] } {
  const body = record(value);
  if (!body) throw new Error('The cut request is invalid');
  return { sourcePath: parseSourcePath(body.sourcePath), ranges: parseRanges(body.ranges) };
}
