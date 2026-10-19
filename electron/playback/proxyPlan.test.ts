import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertExportSourceAllowed,
  buildProxyArgs,
  explainProxyFailure,
  ffmpegFrameRate,
  isInsideProxyCache,
  nextProxyAttempt,
  parseMediaProbe,
  parseProxyRequest,
  parseProxySidecar,
  PROXY_FORMAT_VERSION,
  proxyCacheFileName,
  proxyDimensions,
  proxyOutputPaths,
  serializeProxySidecar,
} from './proxyPlan.js';

const HEVC_STDERR = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'phone.mov':
  Duration: 00:01:30.24, start: 0.000000, bitrate: 45000 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv, bt709), 3840x2160, 43000 kb/s, 29.97 fps, 29.97 tbr, 600 tbn
  Stream #0:1(und): Audio: aac (LC), 48000 Hz, stereo, fltp, 192 kb/s
`;

describe('proxy plan', () => {
  it('reads duration, size, frame rate, and codec from ffmpeg stderr', () => {
    const probe = parseMediaProbe(HEVC_STDERR);
    expect(probe).toMatchObject({
      durationSec: 90.24,
      width: 3840,
      height: 2160,
      fps: 29.97,
      videoCodec: 'hevc',
      hasAudio: true,
    });
  });

  it('sizes 4K down to a hardware-friendly H.264 frame', () => {
    expect(proxyDimensions(3840, 2160, 'full')).toEqual({ width: 1920, height: 1080 });
    expect(proxyDimensions(3840, 2160, 'half')).toEqual({ width: 960, height: 540 });
    expect(proxyDimensions(3840, 2160, 'quarter')).toEqual({ width: 480, height: 270 });
    expect(proxyDimensions(1080, 1920, 'half')).toEqual({ width: 540, height: 960 });
    expect(proxyDimensions(1280, 720, 'full')).toEqual({ width: 1280, height: 720 });
  });

  it('builds an all-intra proxy from the original path', () => {
    const original = '/films/camera/A001.mov';
    const output = '/cache/proxies/abc.part.mp4';
    const args = buildProxyArgs({
      inputPath: original,
      outputPath: output,
      width: 960,
      height: 540,
      fps: 29.97,
      hwaccel: true,
      includeAudio: true,
    });
    const inputAt = args.indexOf('-i');
    expect(args[inputAt + 1]).toBe(original);
    expect(args.slice(0, inputAt)).toContain('-hwaccel');
    expect(args).toContain('scale=960:540:flags=bicubic');
    expect(args).toContain('30000/1001');
    expect(args).toEqual(expect.arrayContaining(['-g', '1', '-keyint_min', '1', '-bf', '0']));
    expect(args[args.length - 1]).toBe(output);
    expect(args.join(' ')).not.toContain('/cache/proxies/abc.part.mp4 -i');
    expect(ffmpegFrameRate(23.976)).toBe('24000/1001');
    expect(ffmpegFrameRate(60)).toBe('60');
  });

  it('retries without hardware decode, then without audio', () => {
    expect(nextProxyAttempt({ hwaccel: true, includeAudio: true, stderr: 'Device creation failed' })).toEqual({
      hwaccel: false,
      includeAudio: true,
    });
    expect(
      nextProxyAttempt({
        hwaccel: false,
        includeAudio: true,
        stderr: 'Stream specifier :a matches no streams',
      }),
    ).toEqual({ hwaccel: false, includeAudio: false });
    expect(nextProxyAttempt({ hwaccel: false, includeAudio: false, stderr: 'disk full' })).toBeNull();
  });

  it('keeps export on the original and refuses proxy-cache paths', () => {
    const root = path.resolve('/tmp/editpro-proxies');
    const proxy = path.join(root, 'clip.mp4');
    const original = path.resolve('/films/A001.mov');
    expect(isInsideProxyCache(root, proxy)).toBe(true);
    expect(isInsideProxyCache(root, root)).toBe(false);
    expect(isInsideProxyCache(root, path.resolve('/tmp/editpro-proxies-evil/clip.mp4'))).toBe(false);
    expect(() => assertExportSourceAllowed(proxy, root, true)).toThrow(/original media/);
    expect(() => assertExportSourceAllowed(original, root, false)).toThrow(/not opened/);
    expect(() => assertExportSourceAllowed(original, root, true)).not.toThrow();
  });

  it('names cache files from the source identity and round-trips the sidecar', () => {
    const name = proxyCacheFileName({
      sourcePath: '/films/A001.mov',
      size: 1000,
      mtimeMs: 10,
      scale: 'half',
    });
    expect(name).toHaveLength(64);
    expect(proxyCacheFileName({ sourcePath: '/films/A001.mov', size: 1000, mtimeMs: 10, scale: 'half' })).toBe(name);
    expect(proxyCacheFileName({ sourcePath: '/films/A001.mov', size: 1000, mtimeMs: 10, scale: 'full' })).not.toBe(name);
    const paths = proxyOutputPaths('/cache', name);
    expect(paths.finalPath.endsWith(`${name}.mp4`)).toBe(true);
    expect(paths.partialPath.endsWith(`${name}.part.mp4`)).toBe(true);
    const sidecar = {
      version: PROXY_FORMAT_VERSION,
      sourcePath: '/films/A001.mov',
      scale: 'half' as const,
      width: 960,
      height: 540,
      fps: 29.97,
      durationSec: 90.24,
      videoCodec: 'hevc',
    };
    expect(parseProxySidecar(serializeProxySidecar(sidecar))).toEqual(sidecar);
    expect(parseProxySidecar('{"version":"old"}')).toBeNull();
    expect(() => parseProxyRequest({ sourcePath: '/films/A001.mov', scale: 'half' })).not.toThrow();
    expect(() => parseProxyRequest({ sourcePath: '/films/A001.mov', scale: 'third' })).toThrow(/resolution/);
    expect(explainProxyFailure('No space left on device')).toMatch(/disk is full/);
  });
});
