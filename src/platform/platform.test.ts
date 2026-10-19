import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectBrowserEncoders, detectPlatformKind, exportFallbackOrder, preferredExportEngine } from './engines';
import { EXPORT_UNAVAILABLE_DETAIL, describeFeature } from './messages';
import { downsampleTo16k } from './web/audioSamples';
import { rewriteFfmpegArgsForWasm } from './web/rewriteArgs';
import { getPlatform, resetBrowserPlatformForTests, setFilePickerForTests } from './index';
import type { PlatformCapabilities } from './types';

const nativeCaps: PlatformCapabilities = {
  kind: 'electron',
  nativeFfmpeg: true,
  nativeProxy: true,
  nativeWhisper: false,
  hardwareDecode: true,
  fileSystemPaths: true,
  autoUpdate: true,
  webCodecs: false,
  mediaRecorder: false,
  ffmpegWasm: false,
  transformersJs: false,
  share: false,
};

const browserCaps: PlatformCapabilities = {
  ...nativeCaps,
  kind: 'web',
  nativeFfmpeg: false,
  nativeProxy: false,
  hardwareDecode: false,
  fileSystemPaths: false,
  autoUpdate: false,
  webCodecs: true,
  mediaRecorder: true,
  ffmpegWasm: true,
  transformersJs: true,
};

describe('export engine order', () => {
  it('prefers the desktop binary, then wasm, WebCodecs, and MediaRecorder', () => {
    expect(exportFallbackOrder({
      nativeFfmpeg: true,
      ffmpegWasm: true,
      webCodecs: true,
      mediaRecorder: true,
    })).toEqual(['native-ffmpeg', 'ffmpeg-wasm', 'webcodecs', 'media-recorder']);
    expect(preferredExportEngine({
      nativeFfmpeg: false,
      ffmpegWasm: false,
      webCodecs: true,
      mediaRecorder: true,
    })).toBe('webcodecs');
    expect(preferredExportEngine({
      nativeFfmpeg: false,
      ffmpegWasm: false,
      webCodecs: false,
      mediaRecorder: false,
    })).toBe('none');
  });

  it('does not treat a headless page as a browser encoder', () => {
    expect(detectBrowserEncoders({})).toEqual({
      mediaRecorder: false,
      webCodecs: false,
      ffmpegWasm: false,
    });
    expect(detectBrowserEncoders(globalThis).ffmpegWasm).toBe(false);
  });
});

describe('feature messages', () => {
  it('tells a page with no encoder to use the desktop ffmpeg', () => {
    const status = describeFeature('ffmpeg-export', {
      ...browserCaps,
      webCodecs: false,
      mediaRecorder: false,
      ffmpegWasm: false,
      transformersJs: false,
    });
    expect(status.available).toBe(false);
    expect(status.detail).toBe(EXPORT_UNAVAILABLE_DETAIL);
    expect(status.detail).toMatch(/desktop app/);
    expect(status.detail).toMatch(/ffmpeg/);
  });

  it('names the browser engines when they exist', () => {
    const status = describeFeature('ffmpeg-export', browserCaps);
    expect(status.available).toBe(true);
    expect(status.summary).toMatch(/ffmpeg\.wasm/);
    expect(status.summary).toMatch(/WebCodecs/);
    expect(status.detail).toMatch(/Nothing is uploaded/);
  });

  it('keeps desktop export on the bundled binary', () => {
    const status = describeFeature('ffmpeg-export', nativeCaps);
    expect(status.engine).toBe('native-ffmpeg');
    expect(status.summary).toMatch(/bundled ffmpeg/);
  });

  it('explains proxy, Whisper, and updates when the native tools are absent', () => {
    expect(describeFeature('ffmpeg-proxy', browserCaps).detail).toMatch(/desktop ffmpeg/);
    expect(describeFeature('whisper', browserCaps).detail).toMatch(/transformers\.js/);
    expect(describeFeature('whisper', browserCaps).detail).toMatch(/not upload/i);
    expect(describeFeature('whisper', nativeCaps).available).toBe(false);
    expect(describeFeature('auto-update', browserCaps).detail).toMatch(/do not install desktop updates/);
  });
});

describe('ffmpeg.wasm argument rewrite', () => {
  it('maps the source and output onto virtual names and drops pipe progress', () => {
    const rewritten = rewriteFfmpegArgsForWasm(
      ['-y', '-progress', 'pipe:1', '-i', 'memory:clip', '-filter_complex', 'scale=1280:720', 'download:out.mp4'],
      'memory:clip',
      'download:out.mp4',
    );
    expect(rewritten.args).toEqual(['-y', '-i', 'input', '-filter_complex', 'scale=1280:720', 'output.mp4']);
    expect(rewritten.outputName).toBe('output.mp4');
    expect(rewritten.blocked).toEqual([]);
  });

  it('reports desktop paths wasm cannot open', () => {
    const rewritten = rewriteFfmpegArgsForWasm(
      ['-i', '/videos/a.mp4', '-i', '/videos/b.mp4', '/videos/out.mp4'],
      '/videos/a.mp4',
      '/videos/out.mp4',
    );
    expect(rewritten.args[1]).toBe('input');
    expect(rewritten.blocked).toEqual(['/videos/b.mp4']);
  });
});

describe('speech samples', () => {
  it('averages down to 16 kHz', () => {
    const input = new Float32Array([0, 2, 4, 6]);
    expect(Array.from(downsampleTo16k(input, 32000))).toEqual([1, 5]);
  });
});

describe('platform host', () => {
  beforeEach(() => {
    resetBrowserPlatformForTests();
    delete window.editpro;
    delete (window as Window & { Capacitor?: unknown }).Capacitor;
  });

  it('uses the browser host when Electron is absent', async () => {
    const platform = getPlatform();
    expect(platform.kind).toBe('web');
    expect(platform.electron).toBeNull();
    expect(platform.exportEngine()).toBe('none');
    expect(await platform.getVersion()).toBe('1.0.0');
    expect(await platform.openExternal('javascript:alert(1)')).toBe(false);
    expect(await platform.transcribe({ samples: null })).toMatchObject({ status: 'unavailable' });
  });

  it('delegates export to the preload bridge', async () => {
    const startVideoExport = vi.fn().mockResolvedValue({ status: 'done', outputPath: '/out.mp4' });
    window.editpro = {
      startVideoExport,
      saveVideo: vi.fn().mockResolvedValue('/out.mp4'),
    } as unknown as NonNullable<typeof window.editpro>;
    const platform = getPlatform();
    expect(detectPlatformKind(window)).toBe('electron');
    expect(platform.kind).toBe('electron');
    expect(platform.exportEngine()).toBe('native-ffmpeg');
    await platform.startVideoExport({ jobId: 'job-1' } as never);
    expect(startVideoExport).toHaveBeenCalledTimes(1);
    expect(platform.electron).toBe(window.editpro);
  });

  it('recognizes a Capacitor shell', () => {
    (window as Window & { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    };
    expect(getPlatform().kind).toBe('capacitor');
    expect(getPlatform().capabilities.nativeFfmpeg).toBe(false);
  });

  it('reads a file the browser picker returned', async () => {
    setFilePickerForTests(async () => [new File(['hello'], 'note.txt', { type: 'text/plain' })]);
    const platform = getPlatform();
    const picked = await platform.openVideo();
    expect(picked).toMatch(/^browser:/);
    expect(await platform.readTextFile(picked!)).toBe('hello');
    const prefs = await platform.setPreferences({ onboardingComplete: true });
    expect(prefs.onboardingComplete).toBe(true);
    expect(await platform.getPreferences()).toMatchObject({ onboardingComplete: true });
  });
});
