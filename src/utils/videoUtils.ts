import type { LumetriColor, AudioTrackSettings, AutoReframeAspect } from '../types';

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_LUMETRI: LumetriColor = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0,
  whites: 0, blacks: 0, temperature: 0, tint: 0, saturation: 0, vibrance: 0,
  curves: {
    masterShadow: 0, masterMidtone: 0, masterHighlight: 0,
    redShadow: 0, redMidtone: 0, redHighlight: 0,
    greenShadow: 0, greenMidtone: 0, greenHighlight: 0,
    blueShadow: 0, blueMidtone: 0, blueHighlight: 0,
  },
  wheels: {
    shadows: { x: 0, y: 0, luminance: 0 },
    midtones: { x: 0, y: 0, luminance: 0 },
    highlights: { x: 0, y: 0, luminance: 0 },
  },
};

export const DEFAULT_AUDIO: AudioTrackSettings = {
  category: 'dialogue',
  noiseReduction: 0,
  clarity: 0,
  deReverb: 0,
  loudness: 0,
  autoDuck: false,
  lowCut: false,
};

// ── Lumetri → CSS filter ────────────────────────────────────────────────────

/**
 * Converts a full LumetriColor state into a CSS filter string for the video element.
 * Applies Basic tone corrections, temperature/tint, saturation, Master Curve,
 * RGB channel curves (approximate hue shifts), and Color Wheel luminance.
 */
export function buildLumetriFilter(lut: LumetriColor): string {
  const parts: string[] = [];

  // ── Basic: Exposure (EV stops, each ≈25% brightness change) ──
  const expBrightness = 1 + lut.exposure * 0.25;
  parts.push(`brightness(${Math.max(0, expBrightness).toFixed(3)})`);

  // ── Basic: Contrast ──
  const contrast = 1 + lut.contrast / 100;
  parts.push(`contrast(${Math.max(0, contrast).toFixed(3)})`);

  // ── Basic: Highlights + Shadows (gentle brightness nudge) ──
  const hlshBrightness = 1 + (lut.highlights + lut.shadows) * 0.003;
  if (Math.abs(hlshBrightness - 1) > 0.005) {
    parts.push(`brightness(${Math.max(0, hlshBrightness).toFixed(3)})`);
  }

  // ── Basic: Whites + Blacks ──
  const wbBrightness = 1 + (lut.whites - lut.blacks) / 200;
  if (Math.abs(wbBrightness - 1) > 0.005) {
    parts.push(`brightness(${Math.max(0, wbBrightness).toFixed(3)})`);
  }

  // ── Basic: Saturation + Vibrance ──
  const saturation = 1 + (lut.saturation + lut.vibrance * 0.7) / 100;
  parts.push(`saturate(${Math.max(0, saturation).toFixed(3)})`);

  // ── Basic: Temperature (cool/warm → hue rotation) ──
  if (lut.temperature !== 0) {
    parts.push(`hue-rotate(${(-lut.temperature * 0.12).toFixed(2)}deg)`);
  }

  // ── Basic: Tint (green/magenta → sepia approximation) ──
  if (Math.abs(lut.tint) > 2) {
    parts.push(`sepia(${(Math.abs(lut.tint) / 400).toFixed(3)})`);
  }

  // ── Curves: Master channel (shadow/midtone/highlight lift) ──
  const cShadow   = lut.curves.masterShadow   / 100;
  const cMidtone  = lut.curves.masterMidtone  / 100;
  const cHighlight= lut.curves.masterHighlight/ 100;
  const curveContrast   = (cHighlight - cShadow) * 0.3;
  const curveBrightness = cMidtone * 0.25;
  if (Math.abs(curveBrightness) > 0.01 || Math.abs(curveContrast) > 0.01) {
    parts.push(
      `brightness(${(1 + curveBrightness).toFixed(3)}) contrast(${(1 + curveContrast).toFixed(3)})`
    );
  }

  // ── Curves: RGB channel bias → approximate hue shift ──
  const rBias = (lut.curves.redShadow   + lut.curves.redMidtone   + lut.curves.redHighlight)   / 300;
  const bBias = (lut.curves.blueShadow  + lut.curves.blueMidtone  + lut.curves.blueHighlight)  / 300;
  const channelHue = (rBias - bBias) * 12;
  if (Math.abs(channelHue) > 0.5) {
    parts.push(`hue-rotate(${channelHue.toFixed(1)}deg)`);
  }

  // ── Color Wheels: luminance contribution ──
  const wheelLum =
    (lut.wheels.shadows.luminance    * 0.3 +
     lut.wheels.midtones.luminance   * 0.5 +
     lut.wheels.highlights.luminance * 0.3) / 100;
  if (Math.abs(wheelLum) > 0.01) {
    parts.push(`brightness(${(1 + wheelLum * 0.4).toFixed(3)})`);
  }

  // ── Color Wheels: hue shift from X axis ──
  const wheelHue = lut.wheels.midtones.x * 15 + lut.wheels.highlights.x * 8 - lut.wheels.shadows.x * 5;
  if (Math.abs(wheelHue) > 0.5) {
    parts.push(`hue-rotate(${wheelHue.toFixed(1)}deg)`);
  }

  return parts.join(' ') || 'none';
}

// ── Auto Reframe crop overlay ────────────────────────────────────────────────

interface ReframeOverlay {
  left: string; right: string; top: string; bottom: string;
}

/**
 * Returns the CSS inset values for the auto-reframe crop overlay.
 * Assumes a 16:9 source; returns null for 'original' or '16:9'.
 */
export function getAutoReframeOverlay(aspect: AutoReframeAspect): ReframeOverlay | null {
  if (aspect === 'original' || aspect === '16:9') return null;
  const sourceAR = 16 / 9;
  const targetAR: Record<string, number> = { '9:16': 9/16, '1:1': 1, '4:5': 4/5, '4:3': 4/3 };
  const ar = targetAR[aspect];
  if (!ar) return null;

  if (ar < sourceAR) {
    // Pillarbox — crop left and right
    const side = ((1 - ar / sourceAR) / 2 * 100).toFixed(2) + '%';
    return { left: side, right: side, top: '0%', bottom: '0%' };
  } else {
    // Letterbox — crop top and bottom
    const tb = ((1 - sourceAR / ar) / 2 * 100).toFixed(2) + '%';
    return { left: '0%', right: '0%', top: tb, bottom: tb };
  }
}


export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Build CSS filter string for video adjustments
 */
export function buildVideoFilter(
  brightness: number,
  contrast: number,
  saturation: number
): string {
  const b = 1 + brightness / 100;
  const c = 1 + contrast / 100;
  const s = 1 + saturation / 100;
  return `brightness(${Math.max(0, b).toFixed(3)}) contrast(${Math.max(0, c).toFixed(3)}) saturate(${Math.max(0, s).toFixed(3)})`;
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
