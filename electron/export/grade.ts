/**
 * Color pipeline shared by the monitor and the encoder: RGB curves, cube
 * strength, color-wheel mapping, and HDR tone-map preview. Export metadata
 * for PQ/HLG is separate so the file stays HDR while the monitor can show SDR.
 */

export interface RgbTriplet {
  r: number;
  g: number;
  b: number;
}

export interface CurvePoint {
  x: number;
  y: number;
}

export interface RgbCurves {
  luma: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

export type CurveChannel = keyof RgbCurves;

export type HdrTransfer = 'sdr' | 'pq' | 'hlg';

export interface HdrSettings {
  transfer: HdrTransfer;
  /** Monitor-only. Export keeps the transfer metadata and does not bake this. */
  toneMapPreview: boolean;
}

export interface CubeLutLike {
  title: string;
  size: number;
  samples: RgbTriplet[];
}

const CURVE_CHANNELS: readonly CurveChannel[] = ['luma', 'red', 'green', 'blue'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function identityLine(): CurvePoint[] {
  return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
}

export function createIdentityCurves(): RgbCurves {
  return { luma: identityLine(), red: identityLine(), green: identityLine(), blue: identityLine() };
}

export function createDefaultHdr(): HdrSettings {
  return { transfer: 'sdr', toneMapPreview: false };
}

export function normalizeCurvePoints(value: unknown): CurvePoint[] {
  if (!Array.isArray(value)) return identityLine();
  const points = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as { x?: unknown; y?: unknown };
      const x = typeof record.x === 'number' ? record.x : Number.NaN;
      const y = typeof record.y === 'number' ? record.y : Number.NaN;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
    })
    .filter((point): point is CurvePoint => point !== null)
    .sort((a, b) => a.x - b.x);
  if (points.length === 0) return identityLine();
  const withEnds = [...points];
  if (withEnds[0].x > 0) withEnds.unshift({ x: 0, y: withEnds[0].y });
  if (withEnds[withEnds.length - 1].x < 1) withEnds.push({ x: 1, y: withEnds[withEnds.length - 1].y });
  const unique: CurvePoint[] = [];
  for (const point of withEnds) {
    const previous = unique[unique.length - 1];
    if (previous && Math.abs(previous.x - point.x) < 0.0005) unique[unique.length - 1] = point;
    else unique.push(point);
  }
  return unique.slice(0, 16);
}

export function normalizeRgbCurves(value: unknown): RgbCurves {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    luma: normalizeCurvePoints(record.luma),
    red: normalizeCurvePoints(record.red),
    green: normalizeCurvePoints(record.green),
    blue: normalizeCurvePoints(record.blue),
  };
}

export function normalizeHdr(value: unknown): HdrSettings {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const transfer = record.transfer === 'pq' || record.transfer === 'hlg' ? record.transfer : 'sdr';
  return { transfer, toneMapPreview: record.toneMapPreview === true };
}

export function sampleCurve(points: readonly CurvePoint[], amount: number): number {
  const x = clamp(amount, 0, 1);
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (sorted.length === 0) return x;
  if (x <= sorted[0].x) return sorted[0].y;
  const last = sorted[sorted.length - 1];
  if (x >= last.x) return last.y;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    if (x > right.x) continue;
    const span = right.x - left.x;
    const t = span <= 1e-6 ? 1 : (x - left.x) / span;
    return left.y + (right.y - left.y) * t;
  }
  return last.y;
}

export function curvesAreNeutral(curves: RgbCurves): boolean {
  return CURVE_CHANNELS.every((channel) => {
    const points = curves[channel];
    return points.length === 2
      && Math.abs(points[0].x) < 0.0005
      && Math.abs(points[0].y) < 0.0005
      && Math.abs(points[1].x - 1) < 0.0005
      && Math.abs(points[1].y - 1) < 0.0005;
  });
}

/** Master curve, then the per-channel curve. Matches the points written for ffmpeg. */
export function applyRgbCurves(rgb: RgbTriplet, curves: RgbCurves): RgbTriplet {
  const channel = (value: number, points: readonly CurvePoint[]) =>
    clamp(sampleCurve(points, sampleCurve(curves.luma, value)), 0, 1);
  return {
    r: channel(rgb.r, curves.red),
    g: channel(rgb.g, curves.green),
    b: channel(rgb.b, curves.blue),
  };
}

function composedPoints(luma: readonly CurvePoint[], channel: readonly CurvePoint[]): CurvePoint[] {
  const count = 8;
  const points: CurvePoint[] = [];
  for (let index = 0; index <= count; index += 1) {
    const x = index / count;
    points.push({ x, y: clamp(sampleCurve(channel, sampleCurve(luma, x)), 0, 1) });
  }
  return points;
}

function formatPoints(points: readonly CurvePoint[]): string {
  return points.map((point) => `${point.x.toFixed(3)}/${point.y.toFixed(3)}`).join(' ');
}

/** ffmpeg `curves` graph. Null when every channel is the identity line. */
export function curvesFilter(curves: RgbCurves): string | null {
  if (curvesAreNeutral(curves)) return null;
  const parts = (['red', 'green', 'blue'] as const).map((channel) => {
    const key = channel === 'red' ? 'r' : channel === 'green' ? 'g' : 'b';
    return `${key}='${formatPoints(composedPoints(curves.luma, curves[channel]))}'`;
  });
  return `curves=${parts.join(':')}`;
}

export function rgbFromWheel(
  angle: number,
  amount: number,
  neutral: number,
  min: number,
  max: number,
): RgbTriplet {
  const reach = Math.max(Math.abs(max - neutral), Math.abs(neutral - min));
  const span = clamp(amount, 0, 1) * reach;
  const raw = {
    r: Math.cos(angle),
    g: Math.cos(angle - (2 * Math.PI) / 3),
    b: Math.cos(angle + (2 * Math.PI) / 3),
  };
  const peak = Math.max(Math.abs(raw.r), Math.abs(raw.g), Math.abs(raw.b), 1e-6);
  const channel = (value: number) => clamp(neutral + (value / peak) * span, min, max);
  return { r: channel(raw.r), g: channel(raw.g), b: channel(raw.b) };
}

export function wheelFromRgb(
  rgb: RgbTriplet,
  neutral: number,
  min: number,
  max: number,
): { angle: number; amount: number } {
  const r = rgb.r - neutral;
  const g = rgb.g - neutral;
  const b = rgb.b - neutral;
  const x = r - (g + b) / 2;
  const y = ((g - b) * Math.sqrt(3)) / 2;
  const reach = Math.max(Math.abs(max - neutral), Math.abs(neutral - min), 1e-6);
  const peak = Math.max(Math.abs(r), Math.abs(g), Math.abs(b));
  return { angle: Math.atan2(y, x), amount: clamp(peak / reach, 0, 1) };
}

export function shiftWheelMaster(rgb: RgbTriplet, delta: number, min: number, max: number): RgbTriplet {
  return {
    r: clamp(rgb.r + delta, min, max),
    g: clamp(rgb.g + delta, min, max),
    b: clamp(rgb.b + delta, min, max),
  };
}

/** Identity sample for a .cube lattice index. Red changes fastest. */
export function latticeRgb(size: number, index: number): RgbTriplet {
  const scale = Math.max(1, size - 1);
  const r = index % size;
  const g = Math.floor(index / size) % size;
  const b = Math.floor(index / (size * size)) % size;
  return { r: r / scale, g: g / scale, b: b / scale };
}

export function mixRgb(from: RgbTriplet, to: RgbTriplet, amount: number): RgbTriplet {
  const t = clamp(amount, 0, 1);
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
}

/** Blend a cube toward identity so preview sampling and the written .cube match. */
export function applyLutStrength<T extends CubeLutLike>(lut: T, strength: number): T {
  const amount = clamp(strength, 0, 1);
  if (amount >= 0.999) return lut;
  return {
    ...lut,
    samples: lut.samples.map((sample, index) => mixRgb(latticeRgb(lut.size, index), sample, amount)),
  };
}

/** ST 2084 inverse, returning 0–1 relative to 10,000 nits. */
export function pqToLinear(encoded: number): number {
  const e = clamp(encoded, 0, 1);
  const m1 = 0.1593017578125;
  const m2 = 78.84375;
  const c1 = 0.8359375;
  const c2 = 18.8515625;
  const c3 = 18.6875;
  const ep = e ** (1 / m2);
  const numerator = Math.max(ep - c1, 0);
  const denominator = Math.max(c2 - c3 * ep, 1e-6);
  return (numerator / denominator) ** (1 / m1);
}

/** BT.2100 HLG inverse OETF, scene linear. */
export function hlgToLinear(encoded: number): number {
  const e = clamp(encoded, 0, 1);
  const a = 0.17883277;
  const b = 0.28466892;
  const c = 0.55991073;
  if (e <= 0.5) return (e * e) / 3;
  return (Math.exp((e - c) / a) + b) / 12;
}

/**
 * Display-referred SDR approximation of an HDR-encoded pixel.
 * Used only by the monitor. The encoder does not bake this curve.
 */
export function toneMapToSdr(rgb: RgbTriplet, transfer: HdrTransfer): RgbTriplet {
  if (transfer === 'sdr') return rgb;
  const map = (value: number) => {
    const linear = transfer === 'pq' ? pqToLinear(value) : hlgToLinear(value);
    const white = transfer === 'pq' ? 0.02 : 1 / 12;
    const compressed = linear / (linear + white);
    return clamp(compressed ** (1 / 2.2), 0, 1);
  };
  return { r: map(rgb.r), g: map(rgb.g), b: map(rgb.b) };
}

export function hdrMetadataArgs(transfer: HdrTransfer, codec: string): string[] {
  if (transfer === 'sdr') return [];
  const trc = transfer === 'pq' ? 'smpte2084' : 'arib-std-b67';
  const args = ['-color_primaries', 'bt2020', '-color_trc', trc, '-colorspace', 'bt2020nc', '-color_range', 'tv'];
  if (codec === 'libx265') {
    args.push('-x265-params', `colorprim=bt2020:transfer=${trc}:colormatrix=bt2020nc`);
  }
  return args;
}
