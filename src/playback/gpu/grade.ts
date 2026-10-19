import type { LumetriColor } from '../../types';

/** Which program-monitor compositor is drawing the picture. */
export type PreviewBackend = 'webgpu' | 'webgl2' | 'css';

/**
 * Preview grade shared by the WebGL2 shader, the WebGPU shader, and the CPU
 * reference used in tests. Neutral exposure/contrast/saturation are 1.
 */
export interface PreviewGrade {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  blur: number;
}

export const NEUTRAL_PREVIEW_GRADE: PreviewGrade = {
  exposure: 1,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  blur: 0,
};

export const PREVIEW_GRADE_UNIFORMS = [
  'u_exposure',
  'u_contrast',
  'u_saturation',
  'u_temperature',
  'u_tint',
  'u_highlights',
  'u_shadows',
  'u_blur',
] as const;

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

export function selectPreviewBackend(caps: { webgpu: boolean; webgl2: boolean }): PreviewBackend {
  if (caps.webgpu) return 'webgpu';
  if (caps.webgl2) return 'webgl2';
  return 'css';
}

export function previewBackendLabel(backend: PreviewBackend): string {
  if (backend === 'webgpu') return 'Preview WebGPU';
  if (backend === 'webgl2') return 'Preview WebGL2';
  return 'Preview CSS';
}

function clampUnit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export interface PreviewEffectSample {
  brightness: number | null;
  contrast: number | null;
  saturation: number | null;
  blur: number | null;
}

/** Map Lumetri basic controls and keyframed effects into shader uniforms. */
export function packPreviewGrade(lumetri: LumetriColor, effects: PreviewEffectSample): PreviewGrade {
  const exposure = Math.max(0, 1 + lumetri.exposure * 0.25)
    * (effects.brightness === null ? 1 : Math.max(0, 1 + effects.brightness));
  const contrastBase = Math.max(0, 1 + lumetri.contrast / 100);
  const contrast = effects.contrast === null ? contrastBase : contrastBase * Math.max(0, effects.contrast);
  const saturationBase = Math.max(0, 1 + (lumetri.saturation + lumetri.vibrance * 0.7) / 100);
  const saturation = effects.saturation === null
    ? saturationBase
    : saturationBase * Math.max(0, effects.saturation);
  return {
    exposure,
    contrast,
    saturation,
    temperature: clampUnit(lumetri.temperature / 100, -1, 1),
    tint: clampUnit(lumetri.tint / 100, -1, 1),
    highlights: clampUnit(lumetri.highlights / 100, -1, 1),
    shadows: clampUnit(lumetri.shadows / 100, -1, 1),
    blur: effects.blur === null ? 0 : Math.max(0, effects.blur),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const span = edge1 - edge0;
  if (span === 0) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / span);
  return t * t * (3 - 2 * t);
}

/** CPU reference for the fragment shader. Blur is a texture operation, not a per-pixel mix. */
export function shadePreviewPixel(
  rgb: { r: number; g: number; b: number },
  grade: PreviewGrade,
): { r: number; g: number; b: number } {
  let r = rgb.r * grade.exposure;
  let g = rgb.g * grade.exposure;
  let b = rgb.b * grade.exposure;
  let luma = r * LUMA_R + g * LUMA_G + b * LUMA_B;
  const shadowMask = smoothstep(0.55, 0, luma);
  const highlightMask = smoothstep(0.45, 1, luma);
  const lift = grade.shadows * shadowMask + grade.highlights * highlightMask;
  r += lift;
  g += lift;
  b += lift;
  r = (r - 0.5) * grade.contrast + 0.5;
  g = (g - 0.5) * grade.contrast + 0.5;
  b = (b - 0.5) * grade.contrast + 0.5;
  luma = r * LUMA_R + g * LUMA_G + b * LUMA_B;
  r = luma + (r - luma) * grade.saturation;
  g = luma + (g - luma) * grade.saturation;
  b = luma + (b - luma) * grade.saturation;
  r += grade.temperature * 0.08;
  b -= grade.temperature * 0.08;
  g += grade.tint * 0.06;
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

const GRADE_BODY = `
float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}
vec3 gradeColor(vec3 color) {
  color *= u_exposure;
  float y = luma(color);
  float shadowMask = smoothstep(0.55, 0.0, y);
  float highlightMask = smoothstep(0.45, 1.0, y);
  color += u_shadows * shadowMask + u_highlights * highlightMask;
  color = (color - 0.5) * u_contrast + 0.5;
  y = luma(color);
  color = mix(vec3(y), color, u_saturation);
  color.r += u_temperature * 0.08;
  color.b -= u_temperature * 0.08;
  color.g += u_tint * 0.06;
  return clamp(color, 0.0, 1.0);
}
`;

export const WEBGL_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 1.0 - (a_pos.y * 0.5 + 0.5));
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const WEBGL_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_frame;
uniform vec2 u_texel;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_temperature;
uniform float u_tint;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_blur;
in vec2 v_uv;
out vec4 outColor;
${GRADE_BODY}
vec3 sampleFrame(vec2 uv) {
  if (u_blur < 0.5) return texture(u_frame, uv).rgb;
  float radius = u_blur;
  vec3 color = texture(u_frame, uv).rgb * 0.225808;
  color += texture(u_frame, uv + vec2(u_texel.x, 0.0) * radius).rgb * 0.193548;
  color += texture(u_frame, uv - vec2(u_texel.x, 0.0) * radius).rgb * 0.193548;
  color += texture(u_frame, uv + vec2(0.0, u_texel.y) * radius).rgb * 0.193548;
  color += texture(u_frame, uv - vec2(0.0, u_texel.y) * radius).rgb * 0.193548;
  return color;
}
void main() {
  outColor = vec4(gradeColor(sampleFrame(v_uv)), 1.0);
}
`;

export const WEBGPU_SHADER = `
struct Grade {
  exposure: f32,
  contrast: f32,
  saturation: f32,
  temperature: f32,
  tint: f32,
  highlights: f32,
  shadows: f32,
  blur: f32,
  texel: vec2f,
}
struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}
@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var frameTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> grade: Grade;

fn luma(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}
fn gradeColor(colorIn: vec3f) -> vec3f {
  var color = colorIn * grade.exposure;
  var y = luma(color);
  let shadowMask = smoothstep(0.55, 0.0, y);
  let highlightMask = smoothstep(0.45, 1.0, y);
  color = color + grade.shadows * shadowMask + grade.highlights * highlightMask;
  color = (color - 0.5) * grade.contrast + 0.5;
  y = luma(color);
  color = mix(vec3f(y), color, grade.saturation);
  color.r = color.r + grade.temperature * 0.08;
  color.b = color.b - grade.temperature * 0.08;
  color.g = color.g + grade.tint * 0.06;
  return clamp(color, vec3f(0.0), vec3f(1.0));
}
fn sampleFrame(uv: vec2f) -> vec3f {
  if (grade.blur < 0.5) {
    return textureSample(frameTex, frameSampler, uv).rgb;
  }
  let radius = grade.blur;
  var color = textureSample(frameTex, frameSampler, uv).rgb * 0.225808;
  color = color + textureSample(frameTex, frameSampler, uv + vec2f(grade.texel.x, 0.0) * radius).rgb * 0.193548;
  color = color + textureSample(frameTex, frameSampler, uv - vec2f(grade.texel.x, 0.0) * radius).rgb * 0.193548;
  color = color + textureSample(frameTex, frameSampler, uv + vec2f(0.0, grade.texel.y) * radius).rgb * 0.193548;
  color = color + textureSample(frameTex, frameSampler, uv - vec2f(0.0, grade.texel.y) * radius).rgb * 0.193548;
  return color;
}
@vertex
fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var uvs = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));
  var out: VertexOut;
  out.pos = vec4f(positions[index], 0.0, 1.0);
  out.uv = uvs[index];
  return out;
}
@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  return vec4f(gradeColor(sampleFrame(in.uv)), 1.0);
}
`;

export function shadersDeclareGrade(webgl: string, webgpu: string): boolean {
  const gpuNames = ['exposure', 'contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows', 'blur'];
  return PREVIEW_GRADE_UNIFORMS.every((name) => webgl.includes(name))
    && gpuNames.every((name) => webgpu.includes(name));
}
