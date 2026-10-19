/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  burnInArgs,
  formatSrt,
  formatVtt,
  parseWhisperJson,
  subtitlesFilter,
  whisperCliArgs,
} from './captions/format.js';
import { keptRanges, renderCutArgs } from './cuts/plan.js';
import { isAllowedDownloadUrl } from './download.js';
import { parseCues, parseDownloadRequest } from './payload.js';

describe('whisper downloads and captions', () => {
  it('allows the pinned hosts and rejects an unknown model', () => {
    expect(isAllowedDownloadUrl('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin')).toBe(true);
    expect(isAllowedDownloadUrl('https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-ubuntu-x64.tar.gz')).toBe(true);
    expect(isAllowedDownloadUrl('https://objects.githubusercontent.com/github-production-release-asset/1')).toBe(true);
    expect(isAllowedDownloadUrl('http://huggingface.co/model.bin')).toBe(false);
    expect(isAllowedDownloadUrl('https://user:pass@huggingface.co/model.bin')).toBe(false);
    expect(isAllowedDownloadUrl('https://evil.example/huggingface.co/model.bin')).toBe(false);
    expect(() => parseDownloadRequest({ kind: 'model', modelId: 'large-v3' })).toThrow(/Unknown speech model/);
  });

  it('parses token offsets and writes SRT and VTT', () => {
    const cues = parseWhisperJson({
      transcription: [{
        text: ' Hello world',
        offsets: { from: 1000, to: 2500 },
        timestamps: { from: '00:00:01,000', to: '00:00:02,500' },
        tokens: [
          { text: '<|en|>', offsets: { from: 0, to: 0 } },
          { text: ' Hello', offsets: { from: 1000, to: 1600 } },
          { text: ' world', offsets: { from: 1600, to: 2500 } },
        ],
      }],
    });
    expect(cues[0]?.words.map((word) => word.text)).toEqual(['Hello', 'world']);
    expect(cues[0]?.words[0]).toMatchObject({ start: 1, end: 1.6 });
    expect(formatSrt(cues)).toContain('00:00:01,000 --> 00:00:02,500');
    const vtt = formatVtt(cues);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.500');
    expect(parseCues(cues)[0]?.text).toBe('Hello world');
    expect(() => parseCues([{ text: 'Hi', start: -1, end: 1, words: [] }])).toThrow(/out of range/);
  });

  it('builds the whisper.cpp command, burn-in graph, and kept-range cut', () => {
    const args = whisperCliArgs({
      modelPath: '/models/tiny.bin',
      wavPath: '/tmp/speech.wav',
      outputBase: '/tmp/transcript',
      language: 'EN',
      threads: 99,
    });
    expect(args).toContain('-ojf');
    expect(args).toContain('--no-gpu');
    expect(args).toContain('16');
    const filter = subtitlesFilter('C:\\Captions\\take.srt');
    expect(filter).toContain('Captions/take.srt');
    expect(filter).toContain('\\:');
    expect(burnInArgs('/in.mp4', '/tmp/captions.srt', '/out.mp4').join(' ')).toContain('subtitles=');
    const kept = keptRanges(10, [{ start: 2, end: 4 }]);
    expect(kept).toEqual([{ start: 0, end: 2 }, { start: 4, end: 10 }]);
    expect(renderCutArgs('/in.mp4', kept, '/out.mp4', false).join(' ')).toContain('between(t\\,0.000\\,2.000)');
  });
});
