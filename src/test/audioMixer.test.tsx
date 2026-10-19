import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AudioMixer from '../components/video/AudioMixer';
import type { TimelineTrack } from '../types';
import { DEFAULT_AUDIO, DEFAULT_LUMETRI } from '../utils/videoUtils';
import { buildExportPlan, type ExportJob } from '../utils/video/exportPlan';
import {
  automationFilter,
  createDefaultCreativeState,
  createDefaultTrackMix,
  meterLevel,
  normalizeCreativeState,
  sampleAutomation,
  trackInsertFilters,
} from '../utils/video/creative';

const tracks: TimelineTrack[] = [
  { id: 'v1', type: 'video', name: 'V1', muted: false, locked: false },
  { id: 'a1', type: 'audio', name: 'A1', muted: false, locked: false },
];

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    jobId: '11111111-2222-4333-a444-555555555555',
    sourcePath: '/videos/interview.mp4',
    outputPath: '/out/interview.mp4',
    trimStart: 0,
    trimEnd: 8,
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
    ...overrides,
  };
}

function graphFor(creative: ReturnType<typeof createDefaultCreativeState>, audio = DEFAULT_AUDIO): string {
  const plan = buildExportPlan(job({ creative, audio }));
  return plan.args[plan.args.indexOf('-filter_complex') + 1];
}

describe('track insert filters and automation', () => {
  it('emits nothing for a neutral channel', () => {
    expect(trackInsertFilters(createDefaultTrackMix('a1'))).toEqual([]);
    expect(trackInsertFilters(undefined)).toEqual([]);
    expect(automationFilter([], 4)).toBeNull();
  });

  it('maps EQ, noise reduction, and the compressor onto ffmpeg', () => {
    const mix = createDefaultTrackMix('a1');
    mix.eq = { lowGain: 3, midGain: -2, midFrequency: 1200, highGain: 4 };
    mix.noiseReduction = 50;
    mix.compressor = { enabled: true, threshold: -18, ratio: 4, attack: 10, release: 200, makeup: 2 };
    const chain = trackInsertFilters(mix).join(',');
    expect(chain).toContain('afftdn=nr=10.00');
    expect(chain).toContain('lowshelf=f=120');
    expect(chain).toContain('g=3.00');
    expect(chain).toContain('equalizer=f=1200');
    expect(chain).toContain('highshelf=f=8000');
    expect(chain).toContain('acompressor=threshold=-18.0dB:ratio=4.00:attack=10.0:release=200:makeup=2.0');
  });

  it('samples a fader ride and encodes the same line as a volume expression', () => {
    const keys = [
      { id: 'a', time: 0, gain: 0 },
      { id: 'b', time: 2, gain: 1 },
    ];
    expect(sampleAutomation(undefined, 1)).toBe(1);
    expect(sampleAutomation(keys, 1)).toBeCloseTo(0.5);
    expect(sampleAutomation(keys, 4)).toBe(1);
    const filter = automationFilter(keys, 4);
    expect(filter).toContain("volume=volume='");
    expect(filter).toContain('eval=frame');
    expect(filter).toContain('2.000');
  });

  it('scales a waveform peak by the fader', () => {
    expect(meterLevel([0.2, 0.8], 4, 4, 0.5)).toBeCloseTo(0.4);
    expect(meterLevel([0.2], 4, 1, 0)).toBe(0);
    expect(meterLevel([], 4, 1, 1)).toBe(0);
  });

  it('fills mixer defaults when an older project omits them', () => {
    const parsed = normalizeCreativeState({
      trackMix: [{ trackId: 'a1', volume: 0.4, solo: false }],
    });
    expect(parsed.trackMix[0]).toEqual({
      ...createDefaultTrackMix('a1'),
      volume: 0.4,
    });
  });
});

describe('loudnorm targets', () => {
  it.each([-14, -23, -16])('normalizes export to %i LUFS once', (target) => {
    const creative = createDefaultCreativeState();
    creative.loudness = { targetLufs: target, normalizeOnExport: true, measuredLufs: -20 };
    creative.trackMix = [{
      ...createDefaultTrackMix('a1'),
      noiseReduction: 20,
      automation: [{ id: 'ride', time: 0, gain: 0.8 }],
    }];
    const graph = graphFor(creative, {
      ...DEFAULT_AUDIO,
      category: 'dialogue',
      loudness: -6,
      noiseReduction: 40,
    });
    expect(graph).toContain(`loudnorm=I=${target.toFixed(1)}`);
    expect(graph).not.toContain('loudnorm=I=-22.0');
    expect(graph.match(/loudnorm=/g)).toHaveLength(1);
    expect(graph).toContain('afftdn=');
    expect(graph).not.toContain('lowshelf');
    expect(graph).toContain('eval=frame');
  });

  it('leaves Essential Sound loudnorm in place until mixer normalize is on', () => {
    const creative = createDefaultCreativeState();
    const graph = graphFor(creative, { ...DEFAULT_AUDIO, category: 'dialogue', loudness: -3 });
    expect(graph).toContain('loudnorm=I=-19.0');
    expect(graph.match(/loudnorm=/g)).toHaveLength(1);
  });
});

describe('AudioMixer', () => {
  it('arms a LUFS target, EQ, compressor, and a fader keyframe', () => {
    const onCreativeChange = vi.fn();
    const onSetTrackMuted = vi.fn();
    const creative = createDefaultCreativeState();
    const { rerender } = render(
      <AudioMixer
        creative={creative}
        tracks={tracks}
        currentTime={1}
        trimStart={0}
        playbackRate={1}
        peaks={[0.25, 0.5, 1]}
        mediaDuration={2}
        onCreativeChange={onCreativeChange}
        onSetTrackMuted={onSetTrackMuted}
      />,
    );

    expect(screen.getByRole('meter', { name: 'A1 meter' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('button', { name: '-23 LUFS' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: '-23 LUFS' }));
    const targeted = onCreativeChange.mock.calls.at(-1)?.[0];
    expect(targeted.loudness).toMatchObject({ targetLufs: -23, normalizeOnExport: true });

    fireEvent.change(screen.getByRole('slider', { name: 'A1 Low EQ' }), { target: { value: '4.5' } });
    const equalized = onCreativeChange.mock.calls.at(-1)?.[0];
    expect(equalized.trackMix[0].eq.lowGain).toBe(4.5);

    fireEvent.click(screen.getByRole('checkbox', { name: 'A1 compressor' }));
    const compressed = onCreativeChange.mock.calls.at(-1)?.[0];
    expect(compressed.trackMix[0].compressor.enabled).toBe(true);

    rerender(
      <AudioMixer
        creative={compressed}
        tracks={tracks}
        currentTime={1}
        trimStart={0}
        playbackRate={1}
        peaks={[0.25, 0.5, 1]}
        mediaDuration={2}
        onCreativeChange={onCreativeChange}
        onSetTrackMuted={onSetTrackMuted}
      />,
    );
    expect(screen.getByRole('slider', { name: 'A1 compressor Threshold' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('slider', { name: 'A1 noise reduction' }), { target: { value: '30' } });
    expect(onCreativeChange.mock.calls.at(-1)?.[0].trackMix[0].noiseReduction).toBe(30);

    fireEvent.click(screen.getByRole('button', { name: 'A1 keyframe fader' }));
    const ridden = onCreativeChange.mock.calls.at(-1)?.[0];
    expect(ridden.trackMix[0].automation).toEqual([
      expect.objectContaining({ id: 'ride_a1_1.000', time: 1, gain: 1 }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'A1 channel mute' }));
    expect(onSetTrackMuted).toHaveBeenCalledWith('a1', true);
  });
});
