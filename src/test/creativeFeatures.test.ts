import { describe, expect, it } from 'vitest';
import { createDefaultPhotoEdits, createDefaultVideoEdits } from '../utils/editSnapshots';
import { parseProject, createProject, serializeProject } from '../utils/projectFile';
import { DEFAULT_AUDIO, DEFAULT_LUMETRI } from '../utils/videoUtils';
import { buildExportPlan, type ExportJob } from '../utils/video/exportPlan';
import {
  applyGrade,
  applyLiftGammaGain,
  createDefaultCreativeState,
  createDefaultLiftGammaGain,
  createTitleFromPreset,
  edgePresentation,
  encoderStatusLabel,
  envelopeGain,
  formatCube,
  liftGammaGainFilter,
  measureLoudness,
  monitorLinearGain,
  normalizeCreativeState,
  parseCube,
  parseEncoderList,
  placeTransition,
  sampleLut,
  selectVideoEncoder,
  siblingOutputPath,
  titlePlacement,
  transitionFrame,
  volumeExpression,
  waveformPeaks,
  xfadeName,
} from '../utils/video/creative';

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

describe('creative project state', () => {
  it('loads an older project by filling the creative defaults', () => {
    const parsed = parseProject(JSON.stringify({
      format: 'editpro',
      version: 1,
      video: { edits: { trimStart: 2, volume: 0.5 } },
    }));
    expect(parsed.video.edits.trimStart).toBe(2);
    expect(parsed.video.edits.volume).toBe(0.5);
    expect(parsed.video.edits.creative).toEqual(createDefaultCreativeState());
    expect(parsed.video.edits.tracks.map((track) => track.id)).toEqual(['v1', 'a1']);
  });

  it('round-trips titles, a cube, the mixer, and the render queue', () => {
    const video = createDefaultVideoEdits();
    video.creative.titles = [{ ...createTitleFromPreset('lower-third', 1), id: 'title-1', text: 'Hello' }];
    video.creative.programAudio = {
      volume: 0.8,
      fadeIn: 0.4,
      fadeOut: 0.6,
      keyframes: [{ id: 'k1', time: 1, gain: 0.2 }],
    };
    video.creative.trackMix = [{ trackId: 'a1', volume: 0.7, solo: true }];
    video.creative.loudness = { targetLufs: -16, normalizeOnExport: true, measuredLufs: -23 };
    video.creative.liftGammaGain = {
      lift: { r: 0, g: 0, b: 0 },
      gamma: { r: 1, g: 1, b: 1 },
      gain: { r: 1.2, g: 1, b: 0.8 },
    };
    const lut = parseCube('TITLE "Warm"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
    video.creative.lut = lut;
    video.creative.renderQueue = [{
      id: 'q1',
      presetId: 'youtube-4k',
      encoder: 'auto',
      codec: 'h264',
      quality: 90,
      outputName: 'cut_4K.mp4',
    }];
    const project = createProject({
      mode: 'video',
      projectPath: '/work/film.editpro',
      savedAt: '2026-10-19T12:00:00.000Z',
      photo: { edits: createDefaultPhotoEdits(), mediaPath: null, mediaName: null },
      video: { edits: video, mediaPath: '/work/a.mp4', mediaName: 'a.mp4', timelineZoom: 1 },
    });
    const parsed = parseProject(serializeProject(project));
    expect(parsed.video.edits.creative.titles[0]?.text).toBe('Hello');
    expect(parsed.video.edits.creative.programAudio.keyframes[0]?.gain).toBe(0.2);
    expect(parsed.video.edits.creative.lut?.size).toBe(2);
    expect(parsed.video.edits.creative.renderQueue[0]?.presetId).toBe('youtube-4k');
    expect(parsed.video.edits.creative).toEqual(normalizeCreativeState(video.creative));
  });
});

describe('audio envelope, mixer, and loudness', () => {
  it('ramps fades and keyframes with the same curve the export expression encodes', () => {
    const audio = {
      volume: 0.5,
      fadeIn: 1,
      fadeOut: 1,
      keyframes: [
        { id: 'a', time: 0, gain: 0 },
        { id: 'b', time: 2, gain: 1 },
      ],
    };
    expect(envelopeGain(audio, 0, 4)).toBe(0);
    expect(envelopeGain(audio, 1, 4)).toBeCloseTo(0.5 * 0.5 * 1);
    expect(envelopeGain(audio, 2, 4)).toBeCloseTo(0.5);
    expect(envelopeGain(audio, 3.5, 4)).toBeCloseTo(0.5 * 0.5);
    const expression = volumeExpression(audio, 4, 1);
    expect(expression).toContain('0.500');
    expect(expression).toContain('2.000');
    expect(expression).toContain('min(1\\,t/1.000)');
  });

  it('solos one track, previews measured makeup, and exports loudnorm', () => {
    const creative = createDefaultCreativeState();
    creative.trackMix = [{ trackId: 'a2', volume: 1, solo: true }];
    creative.loudness = { targetLufs: -14, normalizeOnExport: true, measuredLufs: -20 };
    const tracks = [
      { id: 'v1', muted: false },
      { id: 'a1', muted: false },
      { id: 'a2', muted: false },
    ];
    expect(monitorLinearGain({
      master: 1,
      muted: false,
      tracks,
      creative,
      sourceTime: 1,
      trimStart: 0,
      trimEnd: 4,
      playbackRate: 1,
    })).toBe(0);
    creative.trackMix.push({ trackId: 'a1', volume: 0.5, solo: true });
    const monitor = monitorLinearGain({
      master: 1,
      muted: false,
      tracks,
      creative,
      sourceTime: 1,
      trimStart: 0,
      trimEnd: 4,
      playbackRate: 1,
    });
    const plan = buildExportPlan(job({ creative, volume: 1 }));
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(monitor).toBeCloseTo(0.5 * 10 ** (6 / 20));
    expect(graph).toContain('volume=0.500');
    expect(graph).toContain('loudnorm=I=-14.0');
    expect(graph.match(/loudnorm=/g)).toHaveLength(1);
  });

  it('measures a louder tone as louder than a quiet one', () => {
    const rate = 48000;
    const tone = (amplitude: number) => {
      const samples = new Float32Array(rate);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = Math.sin((2 * Math.PI * 1000 * index) / rate) * amplitude;
      }
      return measureLoudness(samples, rate);
    };
    const quiet = tone(0.05);
    const loud = tone(0.5);
    expect(loud.integrated).toBeGreaterThan(quiet.integrated);
    expect(loud.momentary).toBeGreaterThan(-70);
    const peaks = waveformPeaks(new Float32Array([0, 0.4, -0.9, 0.2]), 2);
    expect(peaks[0]).toBeCloseTo(0.4);
    expect(peaks[1]).toBeCloseTo(0.9);
  });
});

describe('titles, transitions, and color', () => {
  it('places an animated title on the same normalized frame the encoder uses', () => {
    const title = createTitleFromPreset('center-title', 1, 4);
    expect(titlePlacement(title, 0.5)).toBeNull();
    const atStart = titlePlacement(title, 1);
    const settled = titlePlacement(title, 2);
    expect(atStart?.opacity).toBeLessThan(settled?.opacity ?? 0);
    expect(settled).toMatchObject({ text: 'Title', x: 0.5, align: 'center' });
    const plan = buildExportPlan(job({
      creative: { ...createDefaultCreativeState(), titles: [{ ...title, id: 't1' }] },
    }), { fontFile: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' });
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain("text='Title'");
    expect(graph).toContain('fontsize=');
    expect(graph).toContain('borderw=');
    expect(graph).toContain('shadowx=');
    expect(graph).toContain('DejaVuSans.ttf');
  });

  it('drops a dissolve on a cut and previews the same progress the xfade uses', () => {
    const clips = [
      { id: 'a', trackId: 'v1', startTime: 0, endTime: 2 },
      { id: 'b', trackId: 'v1', startTime: 2, endTime: 4 },
    ];
    const placed = placeTransition(clips, 'a', 'b', 'wipe-left', 0.5);
    expect(placed?.duration).toBeCloseTo(0.5);
    expect(xfadeName('wipe-left')).toBe('wipeleft');
    expect(xfadeName('dip-to-white')).toBe('fadewhite');
    expect(transitionFrame('dip-to-black', 0.25).veil).toBeCloseTo(0.5);
    expect(transitionFrame('cross-dissolve', 0.25)).toMatchObject({ outgoingOpacity: 0.75, incomingOpacity: 0.25 });
    const plan = buildExportPlan(job({
      trimStart: 0,
      trimEnd: 2,
      transition: 'cut',
      clips: [{
        sourcePath: '/videos/b.mp4',
        trackType: 'video',
        startTime: 2,
        inPoint: 0,
        outPoint: 2,
        clipId: 'b',
        trackId: 'v1',
      }],
      creative: {
        ...createDefaultCreativeState(),
        transitions: [{ id: 'x', trackId: 'v1', outgoingClipId: 'program', incomingClipId: 'b', kind: 'slide-left', duration: 0.4 }],
      },
    }));
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('xfade=transition=slideleft:duration=0.400');
  });

  it('matches the program-edge fade to the export fade length', () => {
    const atZero = edgePresentation('fade', 0, 8, 0.6);
    const settled = edgePresentation('fade', 1, 8, 0.6);
    expect(atZero.opacity).toBe(0);
    expect(settled.opacity).toBe(1);
    expect(edgePresentation('wipe', 0.3, 8, 0.6).visibleWidth).toBeCloseTo(0.5);
  });

  it('applies lift gamma gain and a cube identically for preview sampling and the lut file', () => {
    const neutral = applyLiftGammaGain({ r: 0.25, g: 0.5, b: 0.75 }, createDefaultLiftGammaGain());
    expect(neutral).toEqual({ r: 0.25, g: 0.5, b: 0.75 });
    const gained = applyLiftGammaGain({ r: 0.25, g: 0.25, b: 0.25 }, {
      lift: { r: 0, g: 0, b: 0 },
      gamma: { r: 1, g: 1, b: 1 },
      gain: { r: 2, g: 1, b: 1 },
    });
    expect(gained.r).toBeCloseTo(0.5);
    expect(gained.g).toBeCloseTo(0.25);
    const filter = liftGammaGainFilter({
      lift: { r: 0.1, g: 0, b: 0 },
      gamma: { r: 1, g: 1, b: 1 },
      gain: { r: 1, g: 1, b: 1 },
    });
    expect(filter).toContain('geq=');
    expect(filter).toContain('0.1000');
    const cube = 'TITLE "Identity"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
    const lut = parseCube(cube);
    expect(lut).not.toBeNull();
    expect(sampleLut(lut!, { r: 1, g: 0, b: 0 })).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseCube(formatCube(lut!))?.samples).toEqual(lut?.samples);
    const graded = applyGrade({ r: 0.5, g: 0.5, b: 0.5 }, createDefaultLiftGammaGain(), lut);
    expect(graded.r).toBeGreaterThan(0);
    const plan = buildExportPlan(job({
      creative: { ...createDefaultCreativeState(), liftGammaGain: {
        lift: { r: 0.1, g: 0, b: 0 },
        gamma: { r: 1, g: 1, b: 1 },
        gain: { r: 1, g: 1, b: 1 },
      }, lut },
    }), { lutCubePath: 'C:/tmp/grade.cube' });
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('geq=');
    expect(graph).toContain('lut3d=file=');
  });
});

describe('delivery presets and encoders', () => {
  it('keeps software H.264 when no GPU encoder is available and falls back from an explicit one', () => {
    expect(selectVideoEncoder({
      choice: 'auto',
      available: ['libx264'],
      format: 'mp4',
      codec: 'h264',
      platform: 'linux',
    })).toMatchObject({ codec: 'libx264', hardware: false });
    expect(selectVideoEncoder({
      choice: 'auto',
      available: null,
      format: 'mp4',
      codec: 'h264',
      platform: 'win32',
    })).toMatchObject({ codec: 'libx264', hardware: false });
    expect(selectVideoEncoder({
      choice: 'auto',
      available: ['h264_nvenc', 'libx264'],
      format: 'mp4',
      codec: 'h264',
      platform: 'win32',
    })).toMatchObject({ codec: 'h264_nvenc', hardware: true, fallback: 'libx264' });
    expect(selectVideoEncoder({
      choice: 'h264_videotoolbox',
      available: [],
      format: 'mp4',
      codec: 'h264',
      platform: 'darwin',
    })).toMatchObject({ codec: 'libx264', hardware: false });
    expect(parseEncoderList(' V....D h264_nvenc           NVIDIA\n A....D aac')).toContain('h264_nvenc');
    expect(parseEncoderList([
      ' V....D h264_qsv             Intel Quick Sync',
      ' V....D h264_amf             AMD AMF',
      ' V....D hevc_nvenc           NVIDIA HEVC',
    ].join('\n'))).toEqual(expect.arrayContaining(['h264_qsv', 'h264_amf', 'hevc_nvenc']));
  });

  it('names the probed hardware encoder and the software fallback', () => {
    const nvenc = selectVideoEncoder({
      choice: 'auto',
      available: ['h264_qsv', 'h264_nvenc', 'libx264', 'libx265'],
      format: 'mp4',
      codec: 'h264',
      platform: 'linux',
    });
    expect(nvenc).toMatchObject({ codec: 'h264_nvenc', hardware: true, fallback: 'libx264' });
    expect(encoderStatusLabel('auto', nvenc)).toContain('h264_nvenc');
    expect(encoderStatusLabel('auto', nvenc)).toContain('libx264');

    const quickSync = selectVideoEncoder({
      choice: 'auto',
      available: ['h264_qsv', 'libx264'],
      format: 'mp4',
      codec: 'h264',
      platform: 'linux',
    });
    expect(quickSync.codec).toBe('h264_qsv');

    const amf = selectVideoEncoder({
      choice: 'h264_amf',
      available: ['h264_amf', 'libx264'],
      format: 'mp4',
      codec: 'h264',
      platform: 'win32',
    });
    expect(amf).toMatchObject({ codec: 'h264_amf', hardware: true });

    const hevc = selectVideoEncoder({
      choice: 'auto',
      available: ['hevc_nvenc', 'libx265'],
      format: 'mp4',
      codec: 'hevc',
      platform: 'linux',
    });
    expect(hevc).toMatchObject({ codec: 'hevc_nvenc', fallback: 'libx265' });

    const software = selectVideoEncoder({
      choice: 'auto',
      available: ['libx264'],
      format: 'mp4',
      codec: 'h264',
      platform: 'linux',
    });
    expect(encoderStatusLabel('auto', software)).toContain('NVENC');
    expect(encoderStatusLabel('h264_amf', { codec: 'libx264', hardware: false, fallback: 'libx264' })).toContain('not available');
    expect(encoderStatusLabel('software', software)).toBe('Software libx264');
  });

  it('encodes YouTube 4K, H.265, and NVENC without changing a plain H.264 plan', () => {
    const plain = buildExportPlan(job());
    expect(plain.videoCodec).toBe('libx264');
    expect(plain.args).toContain('libx264');

    const hevc = buildExportPlan(job({
      options: { resolution: '1080p', frameRate: 30, format: 'mp4', quality: 80, codec: 'hevc', encoder: 'software' },
    }));
    expect(hevc.videoCodec).toBe('libx265');
    expect(hevc.args).toContain('hvc1');

    const gpu = buildExportPlan(job({
      options: {
        resolution: '4K',
        frameRate: 30,
        format: 'mp4',
        quality: 90,
        codec: 'h264',
        encoder: 'h264_nvenc',
        availableEncoders: ['h264_nvenc'],
        platform: 'win32',
      },
    }));
    expect(gpu.videoCodec).toBe('h264_nvenc');
    expect(gpu.width).toBe(3840);
    expect(siblingOutputPath('C:\\Out\\first.mp4', 'second.mp4')).toBe('C:\\Out\\second.mp4');
  });
});
