/**
 * Titles and shape graphics with their own animation curves.
 * These keys are not timeline clip keyframes. A template is a JSON document
 * the project can save and load without the rest of the sequence.
 */

export const MOTION_TEMPLATE_FORMAT = 'editpro-motion' as const;
export const MOTION_TEMPLATE_VERSION = 1;

export type MotionEase = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
export type MotionChannel = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'width' | 'height';
export type MotionShapeKind = 'rect' | 'ellipse' | 'line';
export type MotionAlign = 'left' | 'center' | 'right';

export interface MotionKey {
  /** Seconds from the item's start. */
  time: number;
  value: number;
  ease: MotionEase;
}

export interface MotionShape {
  id: string;
  kind: MotionShapeKind;
  name: string;
  startTime: number;
  endTime: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** Uniform scale on top of width and height. */
  scale: number;
  opacity: number;
  channels: Partial<Record<MotionChannel, MotionKey[]>>;
}

export interface MotionText {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  text: string;
  fontFamily: string;
  /** Percentage of the frame height. */
  fontSize: number;
  color: string;
  align: MotionAlign;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  channels: Partial<Record<MotionChannel, MotionKey[]>>;
}

export interface MotionDocument {
  id: string;
  name: string;
  shapes: MotionShape[];
  texts: MotionText[];
}

export interface MotionTemplate {
  format: typeof MOTION_TEMPLATE_FORMAT;
  version: typeof MOTION_TEMPLATE_VERSION;
  name: string;
  document: MotionDocument;
}

export interface MotionPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  opacity: number;
}

const EASES: readonly MotionEase[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'];
const CHANNELS: readonly MotionChannel[] = ['x', 'y', 'scale', 'rotation', 'opacity', 'width', 'height'];
const SHAPES: readonly MotionShapeKind[] = ['rect', 'ellipse', 'line'];
const ALIGNS: readonly MotionAlign[] = ['left', 'center', 'right'];
const MAX_ITEMS = 32;
const MAX_KEYS = 48;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function num(value: number): string {
  return value.toFixed(3);
}

export function createMotionDocument(name = 'Graphics'): MotionDocument {
  return { id: 'graphics', name, shapes: [], texts: [] };
}

function easeAmount(ease: MotionEase, amount: number): number {
  const t = clamp(amount, 0, 1);
  if (ease === 'hold') return 0;
  if (ease === 'easeIn') return t * t;
  if (ease === 'easeOut') return 1 - (1 - t) * (1 - t);
  if (ease === 'easeInOut') return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  return t;
}

export function sampleMotion(keys: readonly MotionKey[] | undefined, time: number, fallback: number): number {
  if (!keys || keys.length === 0) return fallback;
  const sorted = [...keys].sort((a, b) => a.time - b.time);
  if (time <= sorted[0].time) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (time >= last.time) return last.value;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    if (time <= right.time) {
      const span = right.time - left.time;
      const amount = span <= 1e-6 ? 1 : (time - left.time) / span;
      return left.value + (right.value - left.value) * easeAmount(right.ease, amount);
    }
  }
  return last.value;
}

export function placeMotion(
  item: { startTime: number; endTime: number; x: number; y: number; scale: number; rotation: number; opacity: number; width?: number; height?: number; channels: MotionShape['channels'] },
  sequenceTime: number,
): MotionPlacement | null {
  if (sequenceTime < item.startTime - 1e-6 || sequenceTime >= item.endTime - 1e-6) return null;
  const local = sequenceTime - item.startTime;
  return {
    x: sampleMotion(item.channels.x, local, item.x),
    y: sampleMotion(item.channels.y, local, item.y),
    width: sampleMotion(item.channels.width, local, item.width ?? 0.2),
    height: sampleMotion(item.channels.height, local, item.height ?? 0.08),
    scale: sampleMotion(item.channels.scale, local, item.scale ?? 1),
    rotation: sampleMotion(item.channels.rotation, local, item.rotation),
    opacity: clamp(sampleMotion(item.channels.opacity, local, item.opacity), 0, 1),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function normalizeKeys(value: unknown): MotionKey[] {
  if (!Array.isArray(value)) return [];
  const keys: MotionKey[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    keys.push({
      time: Math.max(0, finite(record.time, 0)),
      value: finite(record.value, 0),
      ease: oneOf(record.ease, EASES, 'linear'),
    });
    if (keys.length >= MAX_KEYS) break;
  }
  keys.sort((a, b) => a.time - b.time);
  return keys;
}

function normalizeChannels(value: unknown): MotionShape['channels'] {
  const record = asRecord(value);
  if (!record) return {};
  const channels: MotionShape['channels'] = {};
  for (const channel of CHANNELS) {
    if (channel in record) channels[channel] = normalizeKeys(record[channel]);
  }
  return channels;
}

function normalizeShape(value: unknown): MotionShape | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  const startTime = Math.max(0, finite(record.startTime, 0));
  const endTime = Math.max(startTime + 0.1, finite(record.endTime, startTime + 3));
  return {
    id: record.id.slice(0, 80),
    kind: oneOf(record.kind, SHAPES, 'rect'),
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 80) : 'Shape',
    startTime,
    endTime,
    fill: color(record.fill, '#111827'),
    stroke: color(record.stroke, '#ffffff'),
    strokeWidth: clamp(finite(record.strokeWidth, 0), 0, 40),
    x: clamp(finite(record.x, 0.1), -0.5, 1.5),
    y: clamp(finite(record.y, 0.75), -0.5, 1.5),
    width: clamp(finite(record.width, 0.4), 0.001, 2),
    height: clamp(finite(record.height, 0.12), 0.001, 2),
    rotation: clamp(finite(record.rotation, 0), -360, 360),
    scale: clamp(finite(record.scale, 1), 0.05, 8),
    opacity: clamp(finite(record.opacity, 1), 0, 1),
    channels: normalizeChannels(record.channels),
  };
}

function normalizeText(value: unknown): MotionText | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  const startTime = Math.max(0, finite(record.startTime, 0));
  const endTime = Math.max(startTime + 0.1, finite(record.endTime, startTime + 3));
  return {
    id: record.id.slice(0, 80),
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 80) : 'Text',
    startTime,
    endTime,
    text: typeof record.text === 'string' ? record.text.slice(0, 180) : 'Title',
    fontFamily: typeof record.fontFamily === 'string' && record.fontFamily.trim() ? record.fontFamily.slice(0, 80) : 'Arial, Helvetica, sans-serif',
    fontSize: clamp(finite(record.fontSize, 8), 1, 40),
    color: color(record.color, '#ffffff'),
    align: oneOf(record.align, ALIGNS, 'left'),
    x: clamp(finite(record.x, 0.1), -0.5, 1.5),
    y: clamp(finite(record.y, 0.5), -0.5, 1.5),
    scale: clamp(finite(record.scale, 1), 0.05, 8),
    rotation: clamp(finite(record.rotation, 0), -360, 360),
    opacity: clamp(finite(record.opacity, 1), 0, 1),
    channels: normalizeChannels(record.channels),
  };
}

export function normalizeMotionDocument(value: unknown): MotionDocument {
  const record = asRecord(value);
  const empty = createMotionDocument();
  if (!record) return empty;
  return {
    id: typeof record.id === 'string' && record.id.trim() ? record.id.trim().slice(0, 80) : empty.id,
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 80) : empty.name,
    shapes: Array.isArray(record.shapes)
      ? record.shapes.map(normalizeShape).filter((item): item is MotionShape => item !== null).slice(0, MAX_ITEMS)
      : [],
    texts: Array.isArray(record.texts)
      ? record.texts.map(normalizeText).filter((item): item is MotionText => item !== null).slice(0, MAX_ITEMS)
      : [],
  };
}

export function serializeMotionTemplate(document: MotionDocument): string {
  const template: MotionTemplate = {
    format: MOTION_TEMPLATE_FORMAT,
    version: MOTION_TEMPLATE_VERSION,
    name: document.name || 'Template',
    document: normalizeMotionDocument(document),
  };
  return JSON.stringify(template, null, 2);
}

export function parseMotionTemplate(raw: string): MotionTemplate | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (!record || record.format !== MOTION_TEMPLATE_FORMAT || record.version !== MOTION_TEMPLATE_VERSION) return null;
  const document = normalizeMotionDocument(record.document);
  return {
    format: MOTION_TEMPLATE_FORMAT,
    version: MOTION_TEMPLATE_VERSION,
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 80) : document.name,
    document: { ...document, name: typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 80) : document.name },
  };
}

function keys(points: readonly { time: number; value: number; ease?: MotionEase }[]): MotionKey[] {
  return points.map((point) => ({ time: point.time, value: point.value, ease: point.ease ?? 'easeOut' }));
}

export function builtinMotionTemplates(): { id: string; label: string; document: MotionDocument }[] {
  const lower: MotionDocument = {
    id: 'lower-third',
    name: 'Lower third',
    shapes: [{
      id: 'bar',
      kind: 'rect',
      name: 'Bar',
      startTime: 0,
      endTime: 4,
      fill: '#111827',
      stroke: '#d4a017',
      strokeWidth: 0,
      x: 0.06,
      y: 0.74,
      width: 0.52,
      height: 0.12,
      rotation: 0,
      scale: 1,
      opacity: 1,
      channels: {
        x: keys([{ time: 0, value: -0.5, ease: 'easeOut' }, { time: 0.45, value: 0.06 }]),
        opacity: keys([{ time: 0, value: 0, ease: 'easeOut' }, { time: 0.35, value: 1 }]),
      },
    }],
    texts: [{
      id: 'name',
      name: 'Name',
      startTime: 0,
      endTime: 4,
      text: 'Lower third',
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: 5.5,
      color: '#ffffff',
      align: 'left',
      x: 0.1,
      y: 0.8,
      scale: 1,
      rotation: 0,
      opacity: 1,
      channels: {
        x: keys([{ time: 0, value: -0.4, ease: 'easeOut' }, { time: 0.45, value: 0.1 }]),
        opacity: keys([{ time: 0, value: 0, ease: 'easeOut' }, { time: 0.4, value: 1 }]),
      },
    }],
  };
  const title: MotionDocument = {
    id: 'title-card',
    name: 'Title card',
    shapes: [{
      id: 'rule',
      kind: 'line',
      name: 'Rule',
      startTime: 0,
      endTime: 4,
      fill: '#d4a017',
      stroke: '#d4a017',
      strokeWidth: 3,
      x: 0.32,
      y: 0.58,
      width: 0.36,
      height: 0.008,
      rotation: 0,
      scale: 1,
      opacity: 1,
      channels: {
        width: keys([{ time: 0, value: 0.02, ease: 'easeOut' }, { time: 0.6, value: 0.36 }]),
        opacity: keys([{ time: 0, value: 0 }, { time: 0.4, value: 1, ease: 'easeOut' }]),
      },
    }],
    texts: [{
      id: 'title',
      name: 'Title',
      startTime: 0,
      endTime: 4,
      text: 'Title',
      fontFamily: 'Georgia, Times New Roman, serif',
      fontSize: 10,
      color: '#ffffff',
      align: 'center',
      x: 0.5,
      y: 0.46,
      scale: 1,
      rotation: 0,
      opacity: 1,
      channels: {
        scale: keys([{ time: 0, value: 0.86, ease: 'easeOut' }, { time: 0.5, value: 1 }]),
        opacity: keys([{ time: 0, value: 0, ease: 'easeOut' }, { time: 0.4, value: 1 }]),
      },
    }],
  };
  const callout: MotionDocument = {
    id: 'callout',
    name: 'Callout',
    shapes: [{
      id: 'bubble',
      kind: 'ellipse',
      name: 'Bubble',
      startTime: 0,
      endTime: 3.5,
      fill: '#1f2937',
      stroke: '#ffffff',
      strokeWidth: 2,
      x: 0.62,
      y: 0.16,
      width: 0.28,
      height: 0.16,
      rotation: 0,
      scale: 1,
      opacity: 1,
      channels: {
        scale: keys([{ time: 0, value: 0.4, ease: 'easeOut' }, { time: 0.35, value: 1 }]),
        opacity: keys([{ time: 0, value: 0 }, { time: 0.25, value: 1, ease: 'easeOut' }]),
      },
    }],
    texts: [{
      id: 'label',
      name: 'Label',
      startTime: 0.1,
      endTime: 3.5,
      text: 'Look here',
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: 4,
      color: '#ffffff',
      align: 'center',
      x: 0.76,
      y: 0.24,
      scale: 1,
      rotation: 0,
      opacity: 1,
      channels: {
        opacity: keys([{ time: 0, value: 0, ease: 'easeOut' }, { time: 0.3, value: 1 }]),
      },
    }],
  };
  const credit: MotionDocument = {
    id: 'end-credit',
    name: 'End credit',
    shapes: [],
    texts: [{
      id: 'credit',
      name: 'Credit',
      startTime: 0,
      endTime: 5,
      text: 'Directed by',
      fontFamily: 'Georgia, Times New Roman, serif',
      fontSize: 6,
      color: '#f5f5f5',
      align: 'center',
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotation: 0,
      opacity: 1,
      channels: {
        y: keys([{ time: 0, value: 0.62, ease: 'easeOut' }, { time: 1.2, value: 0.48 }]),
        opacity: keys([
          { time: 0, value: 0, ease: 'easeOut' },
          { time: 0.6, value: 1, ease: 'linear' },
          { time: 4.2, value: 1, ease: 'easeIn' },
          { time: 5, value: 0 },
        ]),
      },
    }],
  };
  return [
    { id: 'lower-third', label: 'Lower third', document: lower },
    { id: 'title-card', label: 'Title card', document: title },
    { id: 'callout', label: 'Callout', document: callout },
    { id: 'end-credit', label: 'End credit', document: credit },
  ];
}

function escapeFilter(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function localExpr(trimStart: number, rate: number, start: number): string {
  return `(${num(trimStart)}+t*${num(rate)}-${num(start)})`;
}

function easeExpr(ease: MotionEase, amount: string): string {
  if (ease === 'hold') return '0';
  if (ease === 'linear') return amount;
  if (ease === 'easeIn') return `(${amount})*(${amount})`;
  if (ease === 'easeOut') return `(1-(1-(${amount}))*(1-(${amount})))`;
  return `if(lt(${amount}\\,0.5)\\,2*(${amount})*(${amount})\\,1-(((-2*(${amount})+2)*(-2*(${amount})+2))/2))`;
}

function channelExpr(keysIn: readonly MotionKey[] | undefined, fallback: number, local: string): string {
  if (!keysIn || keysIn.length === 0) return num(fallback);
  const sorted = [...keysIn].sort((a, b) => a.time - b.time);
  let expression = num(sorted[sorted.length - 1].value);
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    const span = Math.max(1e-4, right.time - left.time);
    const amount = `((${local}-${num(left.time)})/${num(span)})`;
    const eased = easeExpr(right.ease, amount);
    const lerp = `(${num(left.value)}+(${num(right.value)}-${num(left.value)})*(${eased}))`;
    expression = `if(lt(${local}\\,${num(right.time)})\\,${lerp}\\,${expression})`;
  }
  return `if(lt(${local}\\,${num(sorted[0].time)})\\,${num(sorted[0].value)}\\,${expression})`;
}

function outputWindow(start: number, end: number, trimStart: number, rate: number): { start: number; end: number } | null {
  const safeRate = rate > 0 ? rate : 1;
  const outStart = (start - trimStart) / safeRate;
  const outEnd = (end - trimStart) / safeRate;
  if (outEnd <= 0) return null;
  return { start: Math.max(0, outStart), end: outEnd };
}

interface OpacityStep {
  localStart: number;
  localEnd: number;
  opacity: number;
}

function opacitySteps(item: { startTime: number; endTime: number; opacity: number; channels: MotionShape['channels'] }): OpacityStep[] {
  const duration = item.endTime - item.startTime;
  const keysIn = item.channels.opacity;
  if (!keysIn || keysIn.length < 2) {
    return [{ localStart: 0, localEnd: duration, opacity: item.opacity }];
  }
  const steps: OpacityStep[] = [];
  const slices = 4;
  for (let index = 0; index < slices; index += 1) {
    const localStart = (duration * index) / slices;
    const localEnd = (duration * (index + 1)) / slices;
    const opacity = sampleMotion(keysIn, (localStart + localEnd) / 2, item.opacity);
    if (opacity <= 0.02) continue;
    const previous = steps[steps.length - 1];
    if (previous && Math.abs(previous.opacity - opacity) < 0.04) previous.localEnd = localEnd;
    else steps.push({ localStart, localEnd, opacity });
  }
  return steps.length > 0 ? steps : [{ localStart: 0, localEnd: duration, opacity: item.opacity }];
}

function drawbox(
  placeX: string,
  placeY: string,
  placeW: string,
  placeH: string,
  fill: string,
  opacity: number,
  enableStart: number,
  enableEnd: number,
): string {
  const alpha = Math.round(clamp(opacity, 0, 1) * 255).toString(16).padStart(2, '0');
  return [
    'drawbox',
    `x='${placeX}'`,
    `y='${placeY}'`,
    `w='${placeW}'`,
    `h='${placeH}'`,
    `color=${fill}${alpha}`,
    't=fill',
    `enable='between(t\\,${num(enableStart)}\\,${num(enableEnd)})'`,
  ].join(':');
}

function shapeFilters(
  shape: MotionShape,
  frame: { width: number; height: number },
  trimStart: number,
  rate: number,
): string[] {
  const window = outputWindow(shape.startTime, shape.endTime, trimStart, rate);
  if (!window) return [];
  const local = localExpr(trimStart, rate, shape.startTime);
  const x = `(${channelExpr(shape.channels.x, shape.x, local)})*${frame.width}`;
  const y = `(${channelExpr(shape.channels.y, shape.y, local)})*${frame.height}`;
  const w = `(${channelExpr(shape.channels.width, shape.width, local)})*(${channelExpr(shape.channels.scale, shape.scale, local)})*${frame.width}`;
  const h = `(${channelExpr(shape.channels.height, shape.height, local)})*(${channelExpr(shape.channels.scale, shape.scale, local)})*${frame.height}`;
  const filters: string[] = [];
  const bands = shape.kind === 'ellipse'
    ? [
      { y: 0.18, h: 0.16, w: 0.55 },
      { y: 0.32, h: 0.18, w: 0.82 },
      { y: 0.48, h: 0.18, w: 1 },
      { y: 0.64, h: 0.16, w: 0.82 },
      { y: 0.78, h: 0.14, w: 0.5 },
    ]
    : [{ y: 0, h: 1, w: 1 }];
  for (const step of opacitySteps(shape)) {
    const stepStart = Math.max(window.start, window.start + step.localStart / (rate > 0 ? rate : 1));
    const stepEnd = Math.min(window.end, window.start + step.localEnd / (rate > 0 ? rate : 1));
    if (stepEnd - stepStart <= 0.01) continue;
    for (const band of bands) {
      const bandW = `(${w})*${num(band.w)}`;
      const bandH = shape.kind === 'line' ? `${Math.max(2, shape.strokeWidth)}` : `(${h})*${num(band.h)}`;
      const bandX = `((${x})+(${w})*(1-${num(band.w)})/2)`;
      const bandY = `((${y})+(${h})*${num(band.y)})`;
      filters.push(drawbox(bandX, bandY, bandW, bandH, shape.fill, step.opacity, stepStart, stepEnd));
    }
  }
  return filters;
}

function textFilters(
  text: MotionText,
  frame: { width: number; height: number },
  trimStart: number,
  rate: number,
): string[] {
  if (!text.text.trim()) return [];
  const window = outputWindow(text.startTime, text.endTime, trimStart, rate);
  if (!window) return [];
  const local = localExpr(trimStart, rate, text.startTime);
  const fontSize = `(${channelExpr(text.channels.scale, text.scale, local)})*${num(Math.max(8, (text.fontSize / 100) * frame.height))}`;
  const xPx = `(${channelExpr(text.channels.x, text.x, local)})*${frame.width}`;
  const xExpr = text.align === 'center' ? `${xPx}-text_w/2` : text.align === 'right' ? `${xPx}-text_w` : xPx;
  const yExpr = `(${channelExpr(text.channels.y, text.y, local)})*${frame.height}-text_h/2`;
  const alpha = channelExpr(text.channels.opacity, text.opacity, local);
  return [[
    'drawtext',
    `text='${escapeFilter(text.text)}'`,
    `font='${escapeFilter(text.fontFamily.split(',')[0]?.trim() || 'Sans')}'`,
    `fontsize='${fontSize}'`,
    `fontcolor=${text.color}`,
    `x='${xExpr}'`,
    `y='${yExpr}'`,
    `alpha='${alpha}'`,
    `enable='between(t\\,${num(window.start)}\\,${num(window.end)})'`,
  ].join(':')];
}

/** ffmpeg filters for the graphics layer. Empty when nothing is on screen in the export range. */
export function motionGraphicFilters(
  document: MotionDocument,
  frame: { width: number; height: number },
  trimStart: number,
  playbackRate: number,
): string[] {
  const rate = playbackRate > 0 ? playbackRate : 1;
  const filters: string[] = [];
  for (const shape of document.shapes) filters.push(...shapeFilters(shape, frame, trimStart, rate));
  for (const text of document.texts) filters.push(...textFilters(text, frame, trimStart, rate));
  return filters;
}
