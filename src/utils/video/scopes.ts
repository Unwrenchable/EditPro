/**
 * Video Scopes — Waveform and Vectorscope analysis utilities.
 *
 * These functions operate on raw ImageData pixel buffers and return
 * structured data that can be rendered by VideoScopesPanel.
 *
 * All computations are CPU-side and suitable for offline/still-frame analysis.
 * For real-time use, call these on a requestAnimationFrame-captured canvas frame.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Waveform column — one entry per horizontal pixel of the source frame */
export interface WaveformColumn {
  /** 0-255 luma values sampled across this column (one per row pixel) */
  luma: number[];
}

/** Full waveform result — one WaveformColumn per display column */
export interface WaveformData {
  columns: WaveformColumn[];
  width: number;
  height: number;
}

/** A single point in the vectorscope (Cb/Cr chrominance coordinates) */
export interface VectorscopePoint {
  /** Cb component, normalized to -1..1 */
  cb: number;
  /** Cr component, normalized to -1..1 */
  cr: number;
  /** Pixel density weight (number of source pixels mapped to this bucket) */
  weight: number;
}

/** Full vectorscope result — sparse array of chrominance buckets */
export interface VectorscopeData {
  /** Bucketed cb/cr points (resolution × resolution grid) */
  points: VectorscopePoint[];
  /** Resolution of the bucket grid (e.g. 128 → 128×128) */
  resolution: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert linear 0-255 RGB to ITU-R BT.601 luma (Y) */
function rgbToLuma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Convert 0-255 RGB to normalized Cb/Cr chrominance (-1..1) */
function rgbToCbCr(r: number, g: number, b: number): { cb: number; cr: number } {
  // ITU-R BT.601 digital coefficients (full range)
  const luma = rgbToLuma(r, g, b);
  const cb = (b - luma) / 226.0; // -1..1
  const cr = (r - luma) / 179.0; // -1..1
  return { cb, cr };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute a waveform display from an ImageData frame.
 *
 * Returns one column per horizontal pixel of `imageData`, each containing
 * an array of luma values (0-255) for every row at that x position.
 * The caller can bin or scatter-plot these values to draw the waveform.
 *
 * @param imageData  Raw pixel buffer (RGBA, width × height)
 * @param maxColumns Cap the output column count to keep things fast (default: 512)
 */
export function computeWaveform(imageData: ImageData, maxColumns = 512): WaveformData {
  const { data, width, height } = imageData;
  const step = Math.max(1, Math.floor(width / maxColumns));
  const columns: WaveformColumn[] = [];

  for (let x = 0; x < width; x += step) {
    const luma: number[] = [];
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      luma.push(Math.round(rgbToLuma(data[idx], data[idx + 1], data[idx + 2])));
    }
    columns.push({ luma });
  }

  return { columns, width: columns.length, height };
}

/**
 * Compute a vectorscope from an ImageData frame.
 *
 * Returns a bucketed Cb/Cr grid (resolution × resolution). Each bucket
 * accumulates the number of pixels that fall within it. The result can be
 * rendered as a scatter plot or a heatmap overlay on the standard colour wheel.
 *
 * @param imageData   Raw pixel buffer (RGBA, width × height)
 * @param resolution  Bucket grid size (default: 128 → 128×128 buckets)
 * @param sampleStep  Pixel stride for sub-sampling (default: 2 → every 2nd pixel)
 */
export function computeVectorscope(
  imageData: ImageData,
  resolution = 128,
  sampleStep = 2
): VectorscopeData {
  const { data, width, height } = imageData;
  // Use a flat array for bucket counts (indices: row * resolution + col)
  const buckets = new Float32Array(resolution * resolution);

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const { cb, cr } = rgbToCbCr(r, g, b);

      // Map -1..1 to 0..resolution-1
      const col = Math.round(((cb + 1) / 2) * (resolution - 1));
      const row = Math.round(((cr + 1) / 2) * (resolution - 1));
      const clampedCol = Math.max(0, Math.min(resolution - 1, col));
      const clampedRow = Math.max(0, Math.min(resolution - 1, row));
      buckets[clampedRow * resolution + clampedCol]++;
    }
  }

  // Convert non-zero buckets to VectorscopePoint array
  const points: VectorscopePoint[] = [];
  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      const weight = buckets[row * resolution + col];
      if (weight > 0) {
        points.push({
          cb: (col / (resolution - 1)) * 2 - 1,
          cr: (row / (resolution - 1)) * 2 - 1,
          weight,
        });
      }
    }
  }

  return { points, resolution };
}
