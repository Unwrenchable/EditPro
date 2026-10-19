export interface Point {
  x: number;
  y: number;
}

/** 0 at the left edge of a seek track, 1 at the right edge. */
export function seekRatio(clientX: number, left: number, width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return Math.min(1, Math.max(0, (clientX - left) / width));
}

export function pointerDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Pinch zoom clamped to the timeline's existing range. */
export function pinchScale(startDistance: number, nextDistance: number, startZoom: number): number {
  if (!Number.isFinite(startDistance) || startDistance <= 0) return clampZoom(startZoom);
  if (!Number.isFinite(nextDistance) || nextDistance <= 0) return clampZoom(startZoom);
  return clampZoom(startZoom * (nextDistance / startDistance));
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(8, Math.max(0.5, zoom));
}

export type LayoutHost = 'electron' | 'web' | 'capacitor';

/**
 * The simplified timeline is only for a narrow browser or Capacitor window.
 * A coarse pointer does not count: a desktop mouse and a Windows touch digitizer
 * both stay on the pro timeline. The desktop Electron window never switches.
 */
export function prefersTouchLayout(kind: LayoutHost, matches: (query: string) => boolean): boolean {
  if (kind === 'electron') return false;
  return matches('(max-width: 800px)');
}
