import { describe, expect, it } from 'vitest';
import { nextPreviewAttempt, PreviewSession } from '../playback/gpu/useGpuPreview';
import {
  NEUTRAL_PREVIEW_GRADE,
  packPreviewGrade,
  previewBackendLabel,
  selectPreviewBackend,
  shadePreviewPixel,
  shadersDeclareGrade,
  WEBGL_FRAGMENT_SHADER,
  WEBGPU_SHADER,
} from '../playback/gpu/grade';
import { DEFAULT_LUMETRI } from '../utils/videoUtils';

const neutralEffects = { brightness: null, contrast: null, saturation: null, blur: null };

describe('gpu preview grade', () => {
  it('prefers WebGPU, then WebGL2, then the CSS filter path', () => {
    expect(selectPreviewBackend({ webgpu: true, webgl2: true })).toBe('webgpu');
    expect(selectPreviewBackend({ webgpu: false, webgl2: true })).toBe('webgl2');
    expect(selectPreviewBackend({ webgpu: false, webgl2: false })).toBe('css');
    expect(previewBackendLabel('webgpu')).toBe('Preview WebGPU');
    expect(previewBackendLabel('css')).toBe('Preview CSS');
  });

  it('keeps a neutral grade unchanged and responds to exposure, saturation, and blur packing', () => {
    const identity = shadePreviewPixel({ r: 0.2, g: 0.4, b: 0.6 }, NEUTRAL_PREVIEW_GRADE);
    expect(identity.r).toBeCloseTo(0.2, 5);
    expect(identity.g).toBeCloseTo(0.4, 5);
    expect(identity.b).toBeCloseTo(0.6, 5);

    const packed = packPreviewGrade(DEFAULT_LUMETRI, neutralEffects);
    expect(packed).toMatchObject({ exposure: 1, contrast: 1, saturation: 1, blur: 0 });

    const bright = shadePreviewPixel(
      { r: 0.4, g: 0.4, b: 0.4 },
      packPreviewGrade({ ...DEFAULT_LUMETRI, exposure: 1 }, neutralEffects),
    );
    expect(bright.g).toBeGreaterThan(0.4);

    const gray = shadePreviewPixel(
      { r: 0.2, g: 0.8, b: 0.2 },
      { ...NEUTRAL_PREVIEW_GRADE, saturation: 0 },
    );
    expect(gray.r).toBeCloseTo(gray.g, 5);
    expect(gray.g).toBeCloseTo(gray.b, 5);

    expect(packPreviewGrade(DEFAULT_LUMETRI, { ...neutralEffects, blur: 4 }).blur).toBe(4);
    expect(shadersDeclareGrade(WEBGL_FRAGMENT_SHADER, WEBGPU_SHADER)).toBe(true);
  });

  it('ignores undecoded frames and drops to CSS after three GPU failures', () => {
    expect(nextPreviewAttempt(0, 'pending')).toEqual({ failures: 0, abandon: false });
    expect(nextPreviewAttempt(2, 'pending')).toEqual({ failures: 2, abandon: false });
    expect(nextPreviewAttempt(2, 'drawn')).toEqual({ failures: 0, abandon: false });
    expect(nextPreviewAttempt(1, 'failed')).toEqual({ failures: 2, abandon: false });
    expect(nextPreviewAttempt(2, 'failed')).toEqual({ failures: 3, abandon: true });
  });

  it('falls back to css when the canvas has no WebGL2 or WebGPU context', async () => {
    const canvas = document.createElement('canvas');
    const session = new PreviewSession(canvas);
    await expect(session.start()).resolves.toBe('css');
    expect(session.draw(document.createElement('video'), NEUTRAL_PREVIEW_GRADE)).toBe(false);
    session.dispose();
  });
});
