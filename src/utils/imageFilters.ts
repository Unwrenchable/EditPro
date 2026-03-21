import type { PhotoAdjustments, PhotoFilter, PhotoFilterName } from '../types';

export const DEFAULT_ADJUSTMENTS: PhotoAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  highlights: 0,
  shadows: 0,
  sharpness: 0,
  temperature: 0,
  tint: 0,
  whites: 0,
  blacks: 0,
  vibrance: 0,
  hue: 0,
  noiseReduction: 0,
  clarity: 0,
  texture: 0,
  dehaze: 0,
  vignette: 0,
  grain: 0,
  fade: 0,
};

export const PHOTO_FILTERS: PhotoFilter[] = [
  { name: 'none', label: 'Original', css: '' },
  { name: 'grayscale', label: 'B&W', css: 'grayscale(100%)' },
  { name: 'sepia', label: 'Sepia', css: 'sepia(80%)' },
  { name: 'vivid', label: 'Vivid', css: 'saturate(150%) contrast(110%)' },
  { name: 'cool', label: 'Cool', css: 'hue-rotate(30deg) saturate(110%)' },
  { name: 'warm', label: 'Warm', css: 'hue-rotate(-20deg) saturate(120%)' },
  { name: 'fade', label: 'Fade', css: 'brightness(110%) contrast(80%) saturate(80%)' },
  { name: 'dramatic', label: 'Dramatic', css: 'contrast(130%) saturate(80%)' },
  { name: 'matte', label: 'Matte', css: 'contrast(90%) saturate(85%) brightness(105%)' },
];

/**
 * Converts -100..100 brightness to CSS filter value (0..2)
 */
export function buildCSSFilter(
  adjustments: PhotoAdjustments,
  filterName: PhotoFilterName
): string {
  const parts: string[] = [];

  const baseFilter = PHOTO_FILTERS.find((f) => f.name === filterName);
  if (baseFilter && baseFilter.css) {
    parts.push(baseFilter.css);
  }

  // brightness: exposure + brightness combined → CSS 0..2+
  const brightness =
    1 +
    (adjustments.brightness ?? 0) / 100 +
    (adjustments.exposure ?? 0) / 100 +
    (adjustments.whites ?? 0) / 200 -
    (adjustments.blacks ?? 0) / 200 +
    (adjustments.dehaze ?? 0) / 200;
  parts.push(`brightness(${Math.max(0, brightness).toFixed(3)})`);

  // contrast: base contrast + clarity/texture boost
  const contrast =
    1 +
    (adjustments.contrast ?? 0) / 100 +
    (adjustments.clarity ?? 0) / 200 +
    (adjustments.texture ?? 0) / 300;
  parts.push(`contrast(${Math.max(0, contrast).toFixed(3)})`);

  // saturation: saturation + vibrance (vibrance is weighted saturation)
  const saturation =
    1 + (adjustments.saturation ?? 0) / 100 + (adjustments.vibrance ?? 0) / 150;
  parts.push(`saturate(${Math.max(0, saturation).toFixed(3)})`);

  // temperature (cool/warm): shift hue slightly
  if ((adjustments.temperature ?? 0) !== 0) {
    const hueShift = -(adjustments.temperature ?? 0) * 0.15;
    parts.push(`hue-rotate(${hueShift.toFixed(1)}deg)`);
  }

  // hue rotation
  if ((adjustments.hue ?? 0) !== 0) {
    parts.push(`hue-rotate(${(adjustments.hue ?? 0).toFixed(1)}deg)`);
  }

  // sharpness approximated with contrast
  if ((adjustments.sharpness ?? 0) > 0) {
    const sharpContrast = 1 + (adjustments.sharpness ?? 0) * 0.003;
    parts.push(`contrast(${sharpContrast.toFixed(3)})`);
  }

  // noise reduction: slight blur to simulate smoothing
  if ((adjustments.noiseReduction ?? 0) > 20) {
    const blurPx = ((adjustments.noiseReduction ?? 0) - 20) * 0.01;
    parts.push(`blur(${blurPx.toFixed(2)}px)`);
  }

  // fade: reduce contrast + brightness
  if ((adjustments.fade ?? 0) > 0) {
    const fadeBrightness = 1 + (adjustments.fade ?? 0) * 0.002;
    const fadeContrast = 1 - (adjustments.fade ?? 0) * 0.003;
    parts.push(`brightness(${fadeBrightness.toFixed(3)}) contrast(${Math.max(0, fadeContrast).toFixed(3)})`);
  }

  return parts.join(' ');
}

/**
 * Build transform string for rotation and flipping
 */
export function buildTransform(rotation: number, flipH: boolean, flipV: boolean): string {
  const parts: string[] = [];
  if (rotation !== 0) parts.push(`rotate(${rotation}deg)`);
  const scaleX = flipH ? -1 : 1;
  const scaleY = flipV ? -1 : 1;
  if (flipH || flipV) parts.push(`scale(${scaleX}, ${scaleY})`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/**
 * Export canvas to data URL
 */
export async function exportImage(
  imageUrl: string,
  cssFilter: string,
  transform: string,
  format: 'png' | 'jpeg' | 'webp',
  quality: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      ctx.filter = cssFilter || 'none';

      // Apply transform (rotation and flip)
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);

      // Parse rotation from transform string
      const rotMatch = transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
      const rot = rotMatch ? parseFloat(rotMatch[1]) : 0;
      if (rot !== 0) ctx.rotate((rot * Math.PI) / 180);

      // Parse scale for flip
      const scaleMatch = transform.match(/scale\((-?\d+),\s*(-?\d+)\)/);
      const sx = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
      const sy = scaleMatch ? parseFloat(scaleMatch[2]) : 1;
      ctx.scale(sx, sy);

      ctx.drawImage(img, -canvas.width / 2, -canvas.height / 2);
      ctx.restore();

      const mimeType =
        format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      resolve(canvas.toDataURL(mimeType, quality));
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });
}

/**
 * Format file size in human-readable form
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
