import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO, DEFAULT_LUMETRI } from '../utils/videoUtils';
import { buildExportPlan, type ExportJob } from '../utils/video/exportPlan';
import {
  builtinMotionTemplates,
  motionGraphicFilters,
  normalizeMotionDocument,
  parseMotionTemplate,
  placeMotion,
  sampleMotion,
  serializeMotionTemplate,
} from '../utils/video/motionGraphics';

function job(graphics: ExportJob['graphics']): ExportJob {
  return {
    jobId: '11111111-2222-4333-a444-555555555555',
    sourcePath: '/videos/interview.mp4',
    outputPath: '/out/interview_1080p_30fps.mp4',
    trimStart: 0,
    trimEnd: 4,
    playbackRate: 1,
    volume: 1,
    muted: false,
    videoTrackMuted: false,
    audioTrackMuted: false,
    lumetri: DEFAULT_LUMETRI,
    audio: DEFAULT_AUDIO,
    autoReframe: 'original',
    transition: 'cut',
    clips: [],
    options: { resolution: '1080p', frameRate: 30, format: 'mp4', quality: 90 },
    graphics,
  };
}

describe('motion graphics', () => {
  it('eases between keys and holds the first value before them', () => {
    const keys = [
      { time: 0, value: 0, ease: 'linear' as const },
      { time: 1, value: 10, ease: 'linear' as const },
    ];
    expect(sampleMotion(keys, -1, 4)).toBe(0);
    expect(sampleMotion(keys, 0.5, 4)).toBeCloseTo(5, 5);
    expect(sampleMotion(keys, 2, 4)).toBe(10);
    expect(sampleMotion(undefined, 1, 4)).toBe(4);
    const eased = sampleMotion([
      { time: 0, value: 0, ease: 'linear' },
      { time: 1, value: 100, ease: 'easeIn' },
    ], 0.5, 0);
    expect(eased).toBeCloseTo(25, 5);
  });

  it('hides an item outside its range and slides a lower third in', () => {
    const lower = builtinMotionTemplates().find((item) => item.id === 'lower-third');
    expect(lower).toBeTruthy();
    const bar = lower!.document.shapes[0];
    expect(placeMotion(bar, 5)).toBeNull();
    const start = placeMotion(bar, 0);
    const landed = placeMotion(bar, 0.5);
    expect(start && landed && start.x < landed.x).toBe(true);
    expect(landed?.opacity).toBeGreaterThan(0.9);
  });

  it('round-trips a template as JSON and rejects a foreign file', () => {
    const card = builtinMotionTemplates().find((item) => item.id === 'title-card')!.document;
    const parsed = parseMotionTemplate(serializeMotionTemplate(card));
    expect(parsed?.format).toBe('editpro-motion');
    expect(parsed?.version).toBe(1);
    expect(parsed?.document.texts[0]?.text).toBe('Title');
    expect(parsed?.document.shapes[0]?.kind).toBe('line');
    expect(parseMotionTemplate('{')).toBeNull();
    expect(parseMotionTemplate(JSON.stringify({ format: 'other', version: 1 }))).toBeNull();
    expect(normalizeMotionDocument(null).texts).toEqual([]);
  });

  it('emits drawtext and drawbox filters and the export plan keeps them', () => {
    const callout = builtinMotionTemplates().find((item) => item.id === 'callout')!.document;
    const filters = motionGraphicFilters(callout, { width: 1920, height: 1080 }, 0, 1);
    expect(filters.some((filter) => filter.startsWith('drawtext'))).toBe(true);
    expect(filters.some((filter) => filter.startsWith('drawbox'))).toBe(true);
    expect(filters.join(' ')).toContain('Look here');
    const plan = buildExportPlan(job(callout));
    const graph = plan.args.join(' ');
    expect(graph).toContain('drawtext');
    expect(graph).toContain('Look here');
    expect(graph).toContain('drawbox');
  });
});
