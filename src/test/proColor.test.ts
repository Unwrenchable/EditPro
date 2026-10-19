import { describe, expect, it } from 'vitest';
import { buildExportPlan, type ExportJob } from '../utils/video/exportPlan';
import { DEFAULT_AUDIO, DEFAULT_LUMETRI } from '../utils/videoUtils';
import {
  applyGrade,
  applyLutStrength,
  applyRgbCurves,
  createDefaultCreativeState,
  createDefaultLiftGammaGain,
  createIdentityCurves,
  curvesFilter,
  hdrMetadataArgs,
  parseCube,
  rgbFromWheel,
  sampleCurve,
  toneMapToSdr,
  wheelFromRgb,
} from '../utils/video/creative';

function job(creative: ExportJob['creative']): ExportJob {
  return {
    jobId: '11111111-2222-4333-a444-555555555555',
    sourcePath: '/videos/interview.mp4',
    outputPath: '/out/interview.mp4',
    trimStart: 0,
    trimEnd: 2,
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
    creative,
    options: { resolution: '1080p', frameRate: 24, format: 'mp4', quality: 80, codec: 'hevc' },
  };
}

describe('pro color', () => {
  it('maps a color wheel onto RGB and back', () => {
    const rgb = rgbFromWheel(0, 1, 0, -1, 1);
    expect(rgb.r).toBeCloseTo(1, 5);
    expect(rgb.g).toBeLessThan(0);
    expect(rgb.b).toBeLessThan(0);
    const wheel = wheelFromRgb(rgb, 0, -1, 1);
    expect(wheel.amount).toBeCloseTo(1, 5);
    expect(wheel.angle).toBeCloseTo(0, 5);
  });

  it('samples RGB curves the same way the ffmpeg points are built', () => {
    const curves = createIdentityCurves();
    curves.luma = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    curves.red = [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }];
    expect(sampleCurve(curves.red, 0.5)).toBeCloseTo(0.8, 5);
    const graded = applyRgbCurves({ r: 0.5, g: 0.5, b: 0.5 }, curves);
    expect(graded.r).toBeCloseTo(0.8, 5);
    expect(graded.g).toBeCloseTo(0.5, 5);
    const filter = curvesFilter(curves);
    expect(filter).toContain('r=');
    expect(filter).toContain('0.500/0.800');
    expect(curvesFilter(createIdentityCurves())).toBeNull();
  });

  it('blends a cube toward identity and tone-maps HDR only in preview', () => {
    const lut = parseCube('TITLE "Test"\nLUT_3D_SIZE 2\n0 0 0\n0 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
    expect(lut).not.toBeNull();
    const cleared = applyLutStrength(lut!, 0);
    expect(cleared.samples[1]).toEqual({ r: 1, g: 0, b: 0 });
    const full = applyLutStrength(lut!, 1);
    expect(full.samples[1]).toEqual({ r: 0, g: 0, b: 0 });

    const neutral = createDefaultLiftGammaGain();
    const preview = applyGrade({ r: 0.6, g: 0.6, b: 0.6 }, neutral, null, createIdentityCurves(), 1, {
      transfer: 'pq',
      toneMapPreview: true,
    });
    expect(preview.r).toBeGreaterThan(0);
    expect(preview.r).toBeLessThanOrEqual(1);
    expect(toneMapToSdr({ r: 0.2, g: 0.4, b: 0.6 }, 'sdr')).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
    expect(toneMapToSdr({ r: 0, g: 0, b: 0 }, 'hlg')).toEqual({ r: 0, g: 0, b: 0 });

    const curves = {
      ...createIdentityCurves(),
      red: [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }],
    };
    const plan = buildExportPlan(job({
      ...createDefaultCreativeState(),
      curves,
      hdr: { transfer: 'pq', toneMapPreview: true },
    }));
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('curves=');
    expect(graph).not.toContain('tonemap');
    expect(plan.args).toContain('smpte2084');
    expect(plan.args).toContain('bt2020');
    expect(hdrMetadataArgs('hlg', 'libx265').join(' ')).toContain('arib-std-b67');
    expect(hdrMetadataArgs('sdr', 'libx265')).toEqual([]);
  });
});
