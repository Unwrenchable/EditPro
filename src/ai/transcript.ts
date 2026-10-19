import type { TimeRange, TranscriptWord } from './editPlan';

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/^[^a-z0-9'-]+|[^a-z0-9'-]+$/g, '');
}

function sameWord(before: string, after: string): boolean {
  if (!before || !after) return false;
  if (before === after) return true;
  const shorter = Math.min(before.length, after.length);
  if (shorter < 2) return false;
  return before.startsWith(after) || after.startsWith(before);
}

/**
 * Deleting a word from the transcript removes that word's media.
 * A shortened spelling keeps the media and updates the caption.
 * Inserted words have no picture, so they are dropped.
 */
export function diffTranscript(words: readonly TranscriptWord[], nextText: string): {
  words: TranscriptWord[];
  ranges: TimeRange[];
} {
  const nextTokens = nextText.split(/\s+/).map((token) => token.trim()).filter(Boolean);
  const kept: TranscriptWord[] = [];
  const removed: TranscriptWord[] = [];
  let wordIndex = 0;
  let tokenIndex = 0;
  while (wordIndex < words.length && tokenIndex < nextTokens.length) {
    const word = words[wordIndex];
    const token = nextTokens[tokenIndex];
    if (sameWord(normalize(word.text), normalize(token))) {
      kept.push(token === word.text ? word : { ...word, text: token });
      wordIndex += 1;
      tokenIndex += 1;
      continue;
    }
    const wordWindow = words.slice(wordIndex, wordIndex + 8);
    const tokenWindow = nextTokens.slice(tokenIndex, tokenIndex + 8);
    const wordAhead = wordWindow.findIndex((item) => sameWord(normalize(item.text), normalize(token)));
    const tokenAhead = tokenWindow.findIndex((item) => sameWord(normalize(word.text), normalize(item)));
    if (tokenAhead > 0 && (wordAhead < 0 || tokenAhead <= wordAhead)) {
      tokenIndex += 1;
      continue;
    }
    removed.push(word);
    wordIndex += 1;
  }
  while (wordIndex < words.length) {
    removed.push(words[wordIndex]);
    wordIndex += 1;
  }
  return {
    words: kept,
    ranges: removed.map((word) => ({ start: word.start, end: word.end })),
  };
}

export function transcriptText(words: readonly TranscriptWord[]): string {
  return words.map((word) => word.text).join(' ');
}
