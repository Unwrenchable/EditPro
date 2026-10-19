import { describe, expect, it } from 'vitest';
import { createDefaultVideoEdits } from '../utils/editSnapshots';
import { planRemoval, shiftMarkers } from './editPlan';
import { fillerRanges } from './fillers';
import { diffTranscript, transcriptText } from './transcript';
import type { TranscriptWord } from './editPlan';

function word(id: string, text: string, start: number, end: number): TranscriptWord {
  return { id, text, start, end };
}

describe('filler words and transcript edits', () => {
  const words = [
    word('a', 'Um,', 0.2, 0.5),
    word('b', 'hello', 0.6, 1.0),
    word('c', 'you', 1.2, 1.4),
    word('d', 'know', 1.4, 1.7),
    word('e', 'there', 1.8, 2.2),
  ];

  it('removes spoken fillers and leaves the sentence', () => {
    expect(fillerRanges(words, 'standard').map((range) => range.start)).toEqual([0.2]);
    expect(fillerRanges(words, 'aggressive')).toEqual([
      { start: 0.2, end: 0.5 },
      { start: 1.2, end: 1.7 },
    ]);
  });

  it('deletes media for missing words, keeps a shortened spelling, and drops insertions', () => {
    const diff = diffTranscript(words, 'hel you know friend');
    expect(diff.words.map((item) => item.text)).toEqual(['hel', 'you', 'know']);
    expect(diff.ranges.map((range) => range.start)).toEqual([0.2, 1.8]);
    expect(transcriptText(diff.words)).toBe('hel you know');
    const inserted = diffTranscript(words, 'Um, hello EXTRA there');
    expect(inserted.words.map((item) => item.text)).toEqual(['Um,', 'hello', 'there']);
    expect(inserted.ranges).toEqual([{ start: 1.2, end: 1.4 }, { start: 1.4, end: 1.7 }]);
    const onlyInserted = diffTranscript(
      [word('b', 'hello', 0.6, 1), word('e', 'there', 1.8, 2.2)],
      'hello EXTRA there',
    );
    expect(onlyInserted.words.map((item) => item.text)).toEqual(['hello', 'there']);
    expect(onlyInserted.ranges).toEqual([]);
  });
});

describe('timeline removal plan', () => {
  it('seeds a linked master, ripples one range, and shifts later markers', () => {
    const snap = createDefaultVideoEdits();
    snap.markers = [
      { id: 'keep', time: 1, label: 'Keep', color: 'blue' },
      { id: 'gone', time: 3, label: 'Gone', color: 'red' },
      { id: 'later', time: 8, label: 'Later', color: 'yellow' },
    ];
    let n = 0;
    const next = planRemoval(snap, [{ start: 2, end: 4 }], { src: '/media/take.mp4', duration: 10 }, () => `clip_${n++}`);
    const video = next.clips.filter((clip) => clip.trackId === 'v1');
    expect(video.length).toBeGreaterThan(1);
    expect(Math.max(...next.clips.map((clip) => clip.endTime))).toBeCloseTo(8, 1);
    expect(video.every((clip) => clip.src === '/media/take.mp4')).toBe(true);
    expect(next.markers.map((marker) => marker.id)).toEqual(['keep', 'later']);
    expect(next.markers.find((marker) => marker.id === 'later')?.time).toBeCloseTo(6, 1);
    expect(shiftMarkers(snap.markers, [])).toHaveLength(3);
    expect(next.trimStart).toBe(0);
    expect(next.trimEnd).toBe(0);
  });
});
