/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  backgroundEncode,
  matteSize,
  matteToGray,
  parseHexColor,
  rgbToNchw,
} from './background/plan.js';
import { isAllowedDownloadUrl } from './download.js';

describe('local matte plan', () => {
  it('allows the model host and refuses other addresses', () => {
    expect(isAllowedDownloadUrl('https://huggingface.co/Xenova/modnet/resolve/main/onnx/model_quantized.onnx')).toBe(true);
    expect(isAllowedDownloadUrl('https://cdn-lfs.huggingface.co/repos/ab/model.onnx')).toBe(true);
    expect(isAllowedDownloadUrl('http://huggingface.co/model.onnx')).toBe(false);
    expect(isAllowedDownloadUrl('https://user:pass@huggingface.co/model.onnx')).toBe(false);
    expect(isAllowedDownloadUrl('https://evil.example/huggingface.co/model.onnx')).toBe(false);
  });

  it('builds the MODNet tensor and a transparent or color encode', () => {
    const size = matteSize(1920, 1080);
    expect(size.width % 32).toBe(0);
    expect(size.height % 32).toBe(0);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(1024);
    const rgb = new Uint8Array([255, 0, 128]);
    const tensor = rgbToNchw(rgb, 1, 1);
    expect(tensor[0]).toBeCloseTo(1);
    expect(tensor[1]).toBeCloseTo(-1);
    expect(matteToGray([0, 1, 2], 3)).toEqual(new Uint8Array([0, 255, 255]));
    expect(parseHexColor('#00FF00')).toBe('00ff00');
    const clear = backgroundEncode({
      frameWidth: 320, frameHeight: 240, maskWidth: 64, maskHeight: 64, fps: 30, mode: 'transparent', color: '00ff00',
    });
    expect(clear.videoArgs).toContain('libvpx-vp9');
    expect(clear.filter).toContain('alphamerge');
    const filled = backgroundEncode({
      frameWidth: 320, frameHeight: 240, maskWidth: 64, maskHeight: 64, fps: 30, mode: 'color', color: '#00FF00',
    });
    expect(filled.videoArgs).toContain('libx264');
    expect(filled.filter).toContain('0x00ff00');
  });
});
