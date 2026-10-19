import { describe, it, expect } from 'vitest';
import { DEFAULT_AUDIO, DEFAULT_LUMETRI } from '../utils/videoUtils';
import {
  atempoChain,
  audioProcessFilters,
  buildExportPlan,
  createProgressParser,
  ensureExtension,
  explainFfmpegFailure,
  explainSpawnError,
  ExportPlanError,
  ffmpegStopAction,
  fileUrlToPath,
  isFilesystemPath,
  isMissingAudioError,
  lumetriFilters,
  outputSize,
  parseExportJob,
  progressFromOutTime,
  qualityToCrf,
  qualityToProresProfile,
  resolveFfmpegBinary,
  rewriteAsarPath,
  suggestExportFilename,
  unwrapIpcError,
  type ExportJob,
  type VideoTransition,
} from '../utils/video/exportPlan';
import { isTrackMuted, timelineClipsForExport } from '../utils/video/exportClips';
import { resolveSourcePath } from '../utils/video/sourcePath';
import type { VideoTransition as DomainTransition } from '../types';

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _transitionsMatch: Equal<VideoTransition, DomainTransition> = true;
void _transitionsMatch;

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    jobId: '11111111-2222-4333-a444-555555555555',
    sourcePath: '/videos/interview.mp4',
    outputPath: '/out/interview_1080p_30fps.mp4',
    trimStart: 1,
    trimEnd: 9,
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

describe('export presets and sizing', () => {
  it('maps quality onto a CRF range where 100 is higher quality than 40', () => {
    expect(qualityToCrf(100)).toBe(16);
    expect(qualityToCrf(90)).toBe(18);
    expect(qualityToCrf(40)).toBeGreaterThan(qualityToCrf(90));
    expect(qualityToCrf(1)).toBe(32);
  });

  it('picks a ProRes profile from quality', () => {
    expect(qualityToProresProfile(95)).toBe(3);
    expect(qualityToProresProfile(70)).toBe(2);
    expect(qualityToProresProfile(40)).toBe(1);
  });

  it('sizes 16:9 presets and reframes to even dimensions', () => {
    expect(outputSize('1080p', 'original')).toEqual({ width: 1920, height: 1080 });
    expect(outputSize('1080p', '9:16')).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('1080p', '1:1')).toEqual({ width: 1080, height: 1080 });
    expect(outputSize('1080p', '4:5')).toEqual({ width: 1080, height: 1350 });
    expect(outputSize('4K', '4:3').width % 2).toBe(0);
    expect(outputSize('480p', '9:16')).toEqual({ width: 480, height: 854 });
  });

  it('sanitizes Windows filenames and forces the container extension', () => {
    expect(suggestExportFilename('my:clip?.mov', { resolution: '720p', frameRate: 24, format: 'mp4' }))
      .toBe('my_clip__720p_24fps.mp4');
    expect(ensureExtension('C:\\exports\\video.webm', 'mp4')).toBe('C:\\exports\\video.mp4');
    expect(ensureExtension('/tmp/out', 'mov')).toBe('/tmp/out.mov');
  });
});

describe('lumetri and audio filters', () => {
  it('leaves a neutral grade out of the chain', () => {
    const filters = lumetriFilters(DEFAULT_LUMETRI);
    expect(filters).toEqual([]);
  });

  it('maps exposure, contrast, saturation, temperature, tint, and curves', () => {
    const filters = lumetriFilters({
      ...DEFAULT_LUMETRI,
      exposure: 2,
      contrast: 50,
      saturation: 100,
      temperature: 100,
      tint: 100,
      curves: { ...DEFAULT_LUMETRI.curves, masterHighlight: 100, redMidtone: 40 },
      wheels: {
        ...DEFAULT_LUMETRI.wheels,
        midtones: { x: 0, y: 0, luminance: 100 },
      },
    });
    const chain = filters.join(',');
    expect(chain).toContain('exposure=exposure=2.000');
    expect(chain).toContain('contrast=1.500');
    expect(chain).toContain('saturation=2.000');
    expect(chain).toContain('brightness=0.075');
    expect(chain).toContain('colortemperature=temperature=4000');
    expect(chain).toContain('gm=-0.200');
    expect(chain).toContain('curves=');
    expect(chain).toContain("r='");
  });

  it('builds an atempo chain for rates outside 0.5–2', () => {
    expect(atempoChain(1)).toBeNull();
    expect(atempoChain(0.25)).toBe('atempo=0.5,atempo=0.5');
    expect(atempoChain(2)).toBe('atempo=2');
    expect(atempoChain(0.75)).toBe('atempo=0.75');
  });

  it('maps Essential Sound onto ffmpeg audio filters', () => {
    const filters = audioProcessFilters({
      ...DEFAULT_AUDIO,
      lowCut: true,
      noiseReduction: 50,
      clarity: 50,
      deReverb: 40,
      loudness: -6,
      autoDuck: true,
    }, 0.5, 1);
    const chain = filters.join(',');
    expect(chain).toContain('highpass=f=80');
    expect(chain).toContain('afftdn=nr=10.00');
    expect(chain).toContain('treble=g=4.00');
    expect(chain).toContain('acompressor=');
    expect(chain).toContain('loudnorm=I=-22.0');
    expect(chain).toContain('volume=0.500');
  });
});

describe('buildExportPlan', () => {
  it('encodes a trimmed H.264 MP4 with faststart', () => {
    const plan = buildExportPlan(job());
    expect(plan.outputDurationSec).toBeCloseTo(8);
    expect(plan.videoCodec).toBe('libx264');
    expect(plan.audioCodec).toBe('aac');
    expect(plan.canRetryWithoutAudio).toBe(true);
    expect(plan.args).toContain('-ss');
    expect(plan.args).toContain('1.000');
    expect(plan.args).toContain('-to');
    expect(plan.args).toContain('9.000');
    expect(plan.args).toContain('/videos/interview.mp4');
    expect(plan.args).toContain('libx264');
    expect(plan.args).toContain('18');
    expect(plan.args).toContain('+faststart');
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos');
    expect(graph).toContain('[0:v]');
    expect(graph).toContain('[0:a]');
    expect(plan.args.at(-1)).toBe('/out/interview_1080p_30fps.mp4');
  });

  it('keeps paths with spaces as single arguments', () => {
    const source = 'C:\\Videos\\my clip.mp4';
    const plan = buildExportPlan(job({ sourcePath: source, outputPath: 'C:\\Out\\final.mp4' }));
    expect(plan.args.filter((arg) => arg === source)).toEqual([source]);
  });

  it('crops vertical delivery and drops audio when the track is muted', () => {
    const plan = buildExportPlan(job({
      autoReframe: '9:16',
      audioTrackMuted: true,
      options: { resolution: '1080p', frameRate: 30, format: 'mp4', quality: 80 },
    }));
    expect(plan.width).toBe(1080);
    expect(plan.height).toBe(1920);
    expect(plan.audioCodec).toBeNull();
    expect(plan.args).toContain('-an');
    expect(plan.args.join(' ')).not.toContain('[0:a]');
    expect(plan.args.join(' ')).toContain('crop=1080:1920');
  });

  it('applies speed, a head/tail fade, and loudness', () => {
    const plan = buildExportPlan(job({
      trimStart: 0,
      trimEnd: 8,
      playbackRate: 2,
      transition: 'fade',
      audio: { ...DEFAULT_AUDIO, loudness: -3, category: 'dialogue' },
    }));
    expect(plan.outputDurationSec).toBeCloseTo(4);
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('setpts=(PTS-STARTPTS)/2');
    expect(graph).toContain('atempo=2');
    expect(graph).toContain('fade=t=in:st=0:d=0.600');
    expect(graph).toContain('fade=t=out:st=3.400');
    expect(graph).toContain('loudnorm=I=-19.0');
  });

  it('uses zoompan for the zoom transition', () => {
    const plan = buildExportPlan(job({ trimStart: 0, trimEnd: 5, transition: 'zoom' }));
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('zoompan=z=');
    expect(graph).not.toContain('eval=frame');
  });

  it('uses a wipe expression at the program edges', () => {
    const plan = buildExportPlan(job({ trimStart: 0, trimEnd: 5, transition: 'wipe' }));
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('crop=w=');
    expect(graph).toContain('\\,');
  });

  it('joins timeline clips with xfade and closes gaps with a warning', () => {
    const plan = buildExportPlan(job({
      trimStart: 0,
      trimEnd: 2,
      transition: 'dissolve',
      clips: [{
        sourcePath: '/videos/broll.mp4',
        trackType: 'video',
        startTime: 5,
        inPoint: 0,
        outPoint: 2,
      }],
    }));
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('xfade=transition=dissolve');
    expect(plan.args).toContain('/videos/broll.mp4');
    expect(plan.warnings.some((warning) => warning.includes('Gaps between timeline clips'))).toBe(true);
    expect(plan.outputDurationSec).toBeLessThan(4);
  });

  it('sidechain-ducks an external audio clip when auto duck is on', () => {
    const plan = buildExportPlan(job({
      audio: { ...DEFAULT_AUDIO, autoDuck: true },
      clips: [{
        sourcePath: '/audio/music.wav',
        trackType: 'audio',
        startTime: 0,
        inPoint: 0,
        outPoint: 4,
      }],
    }));
    const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('sidechaincompress=');
    expect(plan.args).toContain('/audio/music.wav');
  });

  it('exports black frames when the video track is muted but audio remains', () => {
    const plan = buildExportPlan(job({ videoTrackMuted: true }));
    expect(plan.args).toContain('color=c=black:s=1920x1080:r=30');
    expect(plan.args).toContain('-shortest');
    expect(plan.audioCodec).toBe('aac');
  });

  it('selects VP9 and ProRes containers', () => {
    const webm = buildExportPlan(job({
      outputPath: '/out/clip.webm',
      options: { resolution: '720p', frameRate: 30, format: 'webm', quality: 70 },
    }));
    expect(webm.videoCodec).toBe('libvpx-vp9');
    expect(webm.audioCodec).toBe('libopus');
    expect(webm.args).toContain('-f');
    expect(webm.args).toContain('webm');

    const mov = buildExportPlan(job({
      outputPath: '/out/clip.mov',
      options: { resolution: '1080p', frameRate: 24, format: 'mov', quality: 92 },
    }));
    expect(mov.args).toContain('prores_ks');
    expect(mov.args).toContain('pcm_s16le');
    expect(mov.args).toContain('yuv422p10le');
    expect(mov.outputPath.endsWith('.mov')).toBe(true);
  });

  it('rejects an empty trim, a muted timeline, and overwriting the source', () => {
    expect(() => buildExportPlan(job({ trimStart: 2, trimEnd: 2 }))).toThrow(ExportPlanError);
    expect(() => buildExportPlan(job({ trimStart: 2, trimEnd: 2 }))).toThrow(/Out point/);
    expect(() => buildExportPlan(job({ videoTrackMuted: true, audioTrackMuted: true }))).toThrow(/muted/);
    expect(() => buildExportPlan(job({
      sourcePath: 'C:\\Films\\Take.mp4',
      outputPath: 'c:/films/take.mp4',
    }))).toThrow(/source video/);
  });
});

describe('progress, cancel, and errors', () => {
  it('parses ffmpeg progress clocks and caps below 100 until the end', () => {
    expect(progressFromOutTime(2, 4)).toBe(50);
    const parser = createProgressParser();
    const updates = parser.push(
      'out_time=00:00:02.000000\nfps=30.00\nprogress=continue\nprogress=end\n',
      4
    );
    expect(updates[0]).toMatchObject({ percent: 50, timeSec: 2, fps: 30, done: false });
    expect(updates[1].done).toBe(true);
    expect(updates[1].percent).toBe(100);
  });

  it('rewrites app.asar paths and prefers the unpacked Windows binary', () => {
    const packed = 'C:\\Program Files\\EditPro\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe';
    expect(rewriteAsarPath(packed)).toBe(
      'C:\\Program Files\\EditPro\\resources\\app.asar.unpacked\\node_modules\\ffmpeg-static\\ffmpeg.exe'
    );
    expect(rewriteAsarPath(rewriteAsarPath(packed))).toBe(rewriteAsarPath(packed));

    const resolved = resolveFfmpegBinary({
      packaged: true,
      platform: 'win32',
      resourcesPath: 'C:\\Program Files\\EditPro\\resources',
      ffmpegStaticPath: packed,
      exists: (candidate) => candidate.endsWith('resources\\ffmpeg-static\\ffmpeg.exe'),
    });
    expect(resolved).toBe('C:\\Program Files\\EditPro\\resources\\ffmpeg-static\\ffmpeg.exe');
  });

  it('explains a missing binary, a missing audio stream, and Windows process kill', () => {
    expect(explainSpawnError({ code: 'ENOENT' })).toMatch(/dist:win/);
    expect(explainFfmpegFailure(1, 'Stream specifier :a matches no streams')).toMatch(/audio stream/);
    expect(isMissingAudioError('matches no streams')).toBe(true);
    expect(explainFfmpegFailure(1, 'No space left on device')).toMatch(/disk is full/);
    expect(ffmpegStopAction(4242, 'win32')).toEqual({
      kind: 'command',
      file: 'taskkill',
      args: ['/pid', '4242', '/t', '/f'],
    });
    expect(ffmpegStopAction(7, 'linux')).toEqual({ kind: 'signal', signal: 'SIGTERM' });
    expect(unwrapIpcError(new Error("Error invoking remote method 'export:start': The Out point must be later.")))
      .toBe('The Out point must be later.');
  });

  it('rejects unsafe export payloads', () => {
    expect(() => parseExportJob({ ...job(), sourcePath: 'relative.mp4' })).toThrow(/full file path/);
    expect(() => parseExportJob({ ...job(), outputPath: '-o' })).toThrow(/not a valid file path/);
    expect(() => parseExportJob({ ...job(), options: { ...job().options, frameRate: 25 } })).toThrow(/Frame rate/);
  });
});

describe('timeline clip paths', () => {
  const tracks = [
    { id: 'v1', type: 'video' as const, muted: false },
    { id: 'a1', type: 'audio' as const, muted: false },
    { id: 'a2', type: 'audio' as const, muted: true },
  ];

  it('keeps disk paths and skips blob clips and muted tracks', () => {
    expect(isFilesystemPath('blob:http://localhost/abc')).toBe(false);
    expect(isFilesystemPath('C:\\Clips\\a.mp4')).toBe(true);
    expect(fileUrlToPath('file:///C:/Clips/a.mp4')).toBe('C:/Clips/a.mp4');
    const result = timelineClipsForExport([
      { src: 'blob:http://localhost/1', trackId: 'v1', startTime: 0, inPoint: 0, outPoint: 1 },
      { src: '/clips/b.mp4', trackId: 'v1', startTime: 1, inPoint: 0, outPoint: 2 },
      { src: '/clips/muted.wav', trackId: 'a2', startTime: 0, inPoint: 0, outPoint: 2 },
    ], tracks);
    expect(result.skippedUnreadable).toBe(1);
    expect(result.clips).toEqual([
      { sourcePath: '/clips/b.mp4', trackType: 'video', startTime: 1, inPoint: 0, outPoint: 2 },
    ]);
    expect(isTrackMuted(tracks, 'a2')).toBe(true);
    expect(isTrackMuted(tracks, 'missing')).toBe(false);
  });

  it('resolves Electron file paths from the bridge or the legacy File.path', () => {
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    expect(resolveSourcePath(file, { getPathForFile: () => 'D:\\Footage\\clip.mp4' })).toBe('D:\\Footage\\clip.mp4');
    expect(resolveSourcePath(file, { getPathForFile: () => '' })).toBeNull();
    Object.defineProperty(file, 'path', { value: '/home/me/clip.mp4' });
    expect(resolveSourcePath(file, { getPathForFile: () => '' })).toBe('/home/me/clip.mp4');
  });
});
