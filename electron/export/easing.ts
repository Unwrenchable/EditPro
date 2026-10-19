/**
 * Shared interpolation for the monitor and the ffmpeg graph.
 * Named presets stay on the historical polynomials. `bezier` is a unit-square
 * cubic (CSS cubic-bezier) so the graph editor's handles and the export
 * samples cannot drift apart.
 */

export type EaseCurve = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold' | 'bezier';

/** Control points of the cubic from (0,0) to (1,1). Y may leave 0–1 to overshoot. */
export interface BezierHandles {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const DEFAULT_BEZIER: BezierHandles = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };

export const BEZIER_PRESETS: readonly { id: string; label: string; handles: BezierHandles }[] = [
  { id: 'linear', label: 'Linear curve', handles: { x1: 0, y1: 0, x2: 1, y2: 1 } },
  { id: 'ease', label: 'Ease', handles: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } },
  { id: 'easeIn', label: 'Ease in curve', handles: { x1: 0.42, y1: 0, x2: 1, y2: 1 } },
  { id: 'easeOut', label: 'Ease out curve', handles: { x1: 0, y1: 0, x2: 0.58, y2: 1 } },
  { id: 'easeInOut', label: 'Ease in-out curve', handles: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 } },
  { id: 'easeInCubic', label: 'Ease in cubic', handles: { x1: 0.55, y1: 0.055, x2: 0.675, y2: 0.19 } },
  { id: 'easeOutCubic', label: 'Ease out cubic', handles: { x1: 0.215, y1: 0.61, x2: 0.355, y2: 1 } },
  { id: 'easeInOutCubic', label: 'Ease in-out cubic', handles: { x1: 0.645, y1: 0.045, x2: 0.355, y2: 1 } },
  { id: 'easeOutBack', label: 'Ease out back', handles: { x1: 0.175, y1: 0.885, x2: 0.32, y2: 1.275 } },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function normalizeBezierHandles(value: Partial<BezierHandles> | null | undefined): BezierHandles {
  const axis = (input: unknown, fallback: number, min: number, max: number) => {
    const number = typeof input === 'number' && Number.isFinite(input) ? input : fallback;
    return clamp(number, min, max);
  };
  return {
    x1: axis(value?.x1, DEFAULT_BEZIER.x1, 0, 1),
    y1: axis(value?.y1, DEFAULT_BEZIER.y1, -0.5, 1.5),
    x2: axis(value?.x2, DEFAULT_BEZIER.x2, 0, 1),
    y2: axis(value?.y2, DEFAULT_BEZIER.y2, -0.5, 1.5),
  };
}

function bezierCoord(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return (u * u * u * p0) + (3 * u * u * t * p1) + (3 * u * t * t * p2) + (t * t * t * p3);
}

function bezierSlope(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return (3 * u * u * (p1 - p0)) + (6 * u * t * (p2 - p1)) + (3 * t * t * (p3 - p2));
}

/** Y of a unit-square cubic at horizontal position `amount` (0–1). */
export function sampleBezier(amount: number, handles?: Partial<BezierHandles> | null): number {
  const x = clamp01(amount);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const curve = normalizeBezierHandles(handles);
  let guess = x;
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const estimate = bezierCoord(guess, 0, curve.x1, curve.x2, 1);
    const slope = bezierSlope(guess, 0, curve.x1, curve.x2, 1);
    if (Math.abs(slope) < 1e-6) break;
    guess = clamp01(guess - (estimate - x) / slope);
  }
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const mid = (low + high) / 2;
    if (bezierCoord(mid, 0, curve.x1, curve.x2, 1) < x) low = mid;
    else high = mid;
  }
  const t = (low + high) / 2;
  return bezierCoord(t, 0, curve.y1, curve.y2, 1);
}

export function applyEaseAmount(t: number, easing: EaseCurve, bezier?: BezierHandles): number {
  const x = clamp01(t);
  switch (easing) {
    case 'hold':
      return 0;
    case 'linear':
      return x;
    case 'easeIn':
      return x * x;
    case 'easeOut':
      return 1 - (1 - x) * (1 - x);
    case 'easeInOut':
      return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) * (-2 * x + 2)) / 2;
    case 'bezier':
      return sampleBezier(x, bezier);
    default:
      return x;
  }
}

/**
 * Piecewise-linear ffmpeg expression of {@link sampleBezier}. Knots match the
 * preview solver; the segments between them are linear so the filter stays
 * inside the bundled ffmpeg expression limits.
 */
export function bezierEaseExpression(handles: BezierHandles | undefined, amount: string, steps = 8): string {
  const curve = normalizeBezierHandles(handles);
  const count = Math.min(16, Math.max(2, Math.floor(steps)));
  let expression = sampleBezier(1, curve).toFixed(4);
  for (let index = count - 1; index >= 0; index -= 1) {
    const start = index / count;
    const end = (index + 1) / count;
    const y0 = sampleBezier(start, curve);
    const y1 = sampleBezier(end, curve);
    const local = `((${amount})-${start.toFixed(4)})/${(end - start).toFixed(4)}`;
    const lerp = `(${y0.toFixed(4)}+(${(y1 - y0).toFixed(4)})*${local})`;
    expression = `if(lt(${amount},${end.toFixed(4)}),${lerp},${expression})`;
  }
  return expression;
}
