import type { TimeRange, TranscriptWord } from './editPlan';

const STANDARD: readonly (readonly string[])[] = [
  ['um'],
  ['uh'],
  ['uhh'],
  ['umm'],
  ['er'],
  ['ah'],
  ['hmm'],
  ['hm'],
  ['mm'],
  ['mhm'],
  ['uh-huh'],
];

const AGGRESSIVE: readonly (readonly string[])[] = [
  ...STANDARD,
  ['you', 'know'],
  ['i', 'mean'],
  ['sort', 'of'],
  ['kind', 'of'],
  ['like'],
];

export type FillerMode = 'standard' | 'aggressive';

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/^[^a-z0-9'-]+|[^a-z0-9'-]+$/g, '');
}

export function fillerRanges(words: readonly TranscriptWord[], mode: FillerMode): TimeRange[] {
  const phrases = mode === 'aggressive' ? AGGRESSIVE : STANDARD;
  const tokens = words.map((word) => normalize(word.text));
  const ranges: TimeRange[] = [];
  let index = 0;
  while (index < words.length) {
    let matched = 0;
    for (const phrase of phrases) {
      if (phrase.length > words.length - index) continue;
      const fits = phrase.every((part, offset) => tokens[index + offset] === part);
      if (!fits) continue;
      const first = words[index];
      const last = words[index + phrase.length - 1];
      if (last.end - first.start <= 1.4) {
        ranges.push({ start: first.start, end: last.end });
        matched = phrase.length;
      }
      break;
    }
    index += matched > 0 ? matched : 1;
  }
  return ranges;
}
