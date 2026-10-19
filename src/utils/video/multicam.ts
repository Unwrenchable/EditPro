/**
 * Multicam sync, live angle cuts, and cut refinement.
 *
 * Audio sync is a normalized cross-correlation of the two waveforms, the same
 * idea Premiere and Vegas use to line up camera audio. The lag search runs
 * through an FFT so a multi-second offset stays responsive. This module does
 * not use clip keyframes; cuts are their own list.
 */
import type { TimelineClip, TimelineTrack } from '../../types';

export interface AudioTake {
  samples: ArrayLike<number>;
  sampleRate: number;
}

export interface SyncEstimate {
  /**
   * Seconds to add to the candidate's timeline position so it matches the
   * reference. Negative means the candidate started late and must move earlier.
   */
  offsetSec: number;
  /** Pearson correlation of the overlapping audio at the chosen lag, -1..1. */
  confidence: number;
  /** Lag in analysis-rate samples. Positive means the candidate is late. */
  lagSamples: number;
}

export interface MulticamAngle {
  id: string;
  name: string;
  /** Project path or file name. Object URLs stay in the panel, not the document. */
  src: string;
  syncOffset: number;
  confidence: number;
}

export interface MulticamCut {
  id: string;
  /** Sequence time, in seconds. */
  time: number;
  angleId: string;
}

export interface MulticamSequence {
  id: string;
  referenceId: string;
  angles: MulticamAngle[];
  /** Sorted by time. The opening cut sits at time 0. */
  cuts: MulticamCut[];
}

export interface EnergyEnvelope {
  /** Samples per second of `values`. */
  sampleRate: number;
  values: ArrayLike<number>;
}

const MAX_ANGLES = 16;
const MAX_CUTS = 4000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function snapToFrame(time: number, frameRate: number): number {
  const fps = frameRate >= 1 && frameRate <= 480 && Number.isFinite(frameRate) ? frameRate : 30;
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.round(time * fps) / fps);
}

function nextPow2(value: number): number {
  let power = 1;
  while (power < value) power <<= 1;
  return power;
}

/** In-place radix-2 FFT. `inverse` divides by N. */
function fft(real: Float64Array, imag: Float64Array, inverse: boolean): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const swapReal = real[i];
      real[i] = real[j];
      real[j] = swapReal;
      const swapImag = imag[i];
      imag[i] = imag[j];
      imag[j] = swapImag;
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = ((Math.PI * 2) / length) * (inverse ? 1 : -1);
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let twistReal = 1;
      let twistImag = 0;
      const half = length >> 1;
      for (let offset = 0; offset < half; offset += 1) {
        const evenReal = real[start + offset];
        const evenImag = imag[start + offset];
        const oddReal = real[start + offset + half];
        const oddImag = imag[start + offset + half];
        const mixedReal = oddReal * twistReal - oddImag * twistImag;
        const mixedImag = oddReal * twistImag + oddImag * twistReal;
        real[start + offset] = evenReal + mixedReal;
        imag[start + offset] = evenImag + mixedImag;
        real[start + offset + half] = evenReal - mixedReal;
        imag[start + offset + half] = evenImag - mixedImag;
        const nextReal = twistReal * stepReal - twistImag * stepImag;
        twistImag = twistReal * stepImag + twistImag * stepReal;
        twistReal = nextReal;
      }
    }
  }
  if (inverse) {
    for (let index = 0; index < n; index += 1) {
      real[index] /= n;
      imag[index] /= n;
    }
  }
}

function prepare(take: AudioTake, analysisRate: number, maxSamples: number): Float32Array {
  const rate = take.sampleRate > 0 ? take.sampleRate : analysisRate;
  const ratio = Math.max(1, rate / analysisRate);
  const available = Math.floor(take.samples.length / ratio);
  const length = Math.max(0, Math.min(maxSamples, available));
  const out = new Float32Array(length);
  if (length === 0) return out;
  let mean = 0;
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(take.samples.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += take.samples[cursor] ?? 0;
    const value = sum / (end - start);
    out[index] = value;
    mean += value;
  }
  mean /= length;
  let energy = 0;
  for (let index = 0; index < length; index += 1) {
    out[index] -= mean;
    energy += out[index] * out[index];
  }
  const rms = Math.sqrt(energy / length);
  if (rms < 1e-8) return new Float32Array(0);
  for (let index = 0; index < length; index += 1) out[index] /= rms;
  return out;
}

function correlation(reference: Float32Array, candidate: Float32Array): Float64Array {
  const n = nextPow2(reference.length + candidate.length - 1);
  const realA = new Float64Array(n);
  const imagA = new Float64Array(n);
  const realB = new Float64Array(n);
  const imagB = new Float64Array(n);
  realA.set(reference);
  realB.set(candidate);
  fft(realA, imagA, false);
  fft(realB, imagB, false);
  for (let index = 0; index < n; index += 1) {
    const a = realA[index];
    const b = imagA[index];
    const c = realB[index];
    const d = -imagB[index];
    realA[index] = a * c - b * d;
    imagA[index] = a * d + b * c;
  }
  fft(realA, imagA, true);
  return realA;
}

function valueAtLag(corr: Float64Array, lag: number): number {
  if (lag >= 0 && lag < corr.length) return corr[lag];
  if (lag < 0 && -lag < corr.length) return corr[corr.length + lag];
  return 0;
}

/** Parabolic offset of a discrete peak, in samples, clamped to half a sample. */
export function subsamplePeak(left: number, center: number, right: number): number {
  const denom = left - 2 * center + right;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) return 0;
  return clamp((left - right) / (2 * denom), -0.5, 0.5);
}

function pearsonAt(reference: Float32Array, candidate: Float32Array, lag: number): number {
  const start = Math.max(0, lag);
  const end = Math.min(reference.length, lag + candidate.length);
  const count = end - start;
  if (count < 8) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let index = start; index < end; index += 1) {
    sumA += reference[index];
    sumB += candidate[index - lag];
  }
  const meanA = sumA / count;
  const meanB = sumB / count;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let index = start; index < end; index += 1) {
    const deltaA = reference[index] - meanA;
    const deltaB = candidate[index - lag] - meanB;
    cov += deltaA * deltaB;
    varA += deltaA * deltaA;
    varB += deltaB * deltaB;
  }
  if (varA < 1e-8 || varB < 1e-8) return 0;
  return clamp(cov / Math.sqrt(varA * varB), -1, 1);
}

export function estimateSyncOffset(
  reference: AudioTake,
  candidate: AudioTake,
  options?: { maxOffsetSec?: number; analysisRate?: number; maxSeconds?: number },
): SyncEstimate {
  const analysisRate = options?.analysisRate && options.analysisRate >= 1000 ? options.analysisRate : 8000;
  const maxOffsetSec = clamp(options?.maxOffsetSec ?? 8, 0.05, 120);
  const maxSeconds = clamp(options?.maxSeconds ?? 20, 1, 120);
  const maxSamples = Math.round(analysisRate * (maxSeconds + maxOffsetSec));
  const ref = prepare(reference, analysisRate, maxSamples);
  const cand = prepare(candidate, analysisRate, maxSamples);
  const none: SyncEstimate = { offsetSec: 0, confidence: 0, lagSamples: 0 };
  if (ref.length < 16 || cand.length < 16) return none;
  const corr = correlation(ref, cand);
  const maxLag = Math.min(Math.round(maxOffsetSec * analysisRate), ref.length - 1, cand.length - 1);
  let bestLag = 0;
  let best = Number.NEGATIVE_INFINITY;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const score = valueAtLag(corr, lag);
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  const delta = subsamplePeak(
    valueAtLag(corr, bestLag - 1),
    valueAtLag(corr, bestLag),
    valueAtLag(corr, bestLag + 1),
  );
  const lagSamples = bestLag + delta;
  // Correlation lag is negative when the candidate waveform occurs later.
  // The timeline offset is that lag in seconds, so a late camera moves earlier.
  return {
    offsetSec: lagSamples / analysisRate,
    confidence: pearsonAt(ref, cand, bestLag),
    lagSamples,
  };
}

export function syncAngleOffsets(
  reference: AudioTake & { id: string },
  others: readonly (AudioTake & { id: string })[],
  options?: { maxOffsetSec?: number },
): { id: string; offsetSec: number; confidence: number }[] {
  return others.map((take) => {
    const estimate = estimateSyncOffset(reference, take, options);
    return { id: take.id, offsetSec: estimate.offsetSec, confidence: estimate.confidence };
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function text(value: unknown, fallback: string, max: number): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

export function createMulticamSequence(
  angles: readonly { id: string; name: string; src: string }[],
  id = 'multicam',
): MulticamSequence {
  const limited = angles.slice(0, MAX_ANGLES).filter((angle) => angle.id && angle.src);
  const referenceId = limited[0]?.id ?? '';
  return {
    id,
    referenceId,
    angles: limited.map((angle) => ({
      id: angle.id,
      name: angle.name || angle.src,
      src: angle.src,
      syncOffset: 0,
      confidence: 1,
    })),
    cuts: referenceId ? [{ id: `${id}_open`, time: 0, angleId: referenceId }] : [],
  };
}

export function normalizeMulticamSequence(value: unknown): MulticamSequence | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = text(record.id, '', 80);
  if (!id) return null;
  if (!Array.isArray(record.angles)) return null;
  const angles: MulticamAngle[] = [];
  for (const entry of record.angles) {
    const angle = asRecord(entry);
    if (!angle || typeof angle.id !== 'string' || !angle.id) continue;
    if (typeof angle.src !== 'string' || !angle.src) continue;
    const confidence = typeof angle.confidence === 'number' && Number.isFinite(angle.confidence) ? angle.confidence : 0;
    const syncOffset = typeof angle.syncOffset === 'number' && Number.isFinite(angle.syncOffset) ? angle.syncOffset : 0;
    angles.push({
      id: angle.id.slice(0, 80),
      name: text(angle.name, angle.src, 120),
      src: angle.src.slice(0, 4096),
      syncOffset: clamp(syncOffset, -12 * 3600, 12 * 3600),
      confidence: clamp(confidence, -1, 1),
    });
    if (angles.length >= MAX_ANGLES) break;
  }
  if (angles.length === 0) return null;
  const known = new Set(angles.map((angle) => angle.id));
  const referenceId = typeof record.referenceId === 'string' && known.has(record.referenceId)
    ? record.referenceId
    : angles[0].id;
  const cuts: MulticamCut[] = [];
  if (Array.isArray(record.cuts)) {
    for (const entry of record.cuts) {
      const cut = asRecord(entry);
      if (!cut || typeof cut.id !== 'string' || !cut.id) continue;
      if (typeof cut.angleId !== 'string' || !known.has(cut.angleId)) continue;
      const time = typeof cut.time === 'number' && Number.isFinite(cut.time) ? cut.time : 0;
      cuts.push({ id: cut.id.slice(0, 80), time: Math.max(0, time), angleId: cut.angleId });
      if (cuts.length >= MAX_CUTS) break;
    }
  }
  cuts.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  if (cuts.length === 0 || cuts[0].time > 0) {
    cuts.unshift({ id: `${id}_open`, time: 0, angleId: referenceId });
  }
  const unique: MulticamCut[] = [];
  for (const cut of cuts) {
    const previous = unique[unique.length - 1];
    if (previous && Math.abs(previous.time - cut.time) < 1e-4) {
      unique[unique.length - 1] = cut;
      continue;
    }
    if (previous && previous.angleId === cut.angleId) continue;
    unique.push(cut);
  }
  return { id, referenceId, angles, cuts: unique };
}

export function addMulticamAngles(
  sequence: MulticamSequence | null,
  incoming: readonly { id: string; name: string; src: string }[],
): MulticamSequence {
  const current = sequence ?? createMulticamSequence([], 'multicam');
  const known = new Set(current.angles.map((angle) => angle.src));
  const added = incoming.filter((angle) => angle.id && angle.src && !known.has(angle.src) && !current.angles.some((item) => item.id === angle.id));
  const angles = [
    ...current.angles,
    ...added.map((angle) => ({
      id: angle.id,
      name: angle.name || angle.src,
      src: angle.src,
      syncOffset: 0,
      confidence: 1,
    })),
  ].slice(0, MAX_ANGLES);
  if (angles.length === 0) return current;
  const referenceId = current.angles.some((angle) => angle.id === current.referenceId) ? current.referenceId : angles[0].id;
  const cuts = current.cuts.length > 0 ? current.cuts : [{ id: `${current.id}_open`, time: 0, angleId: referenceId }];
  return { ...current, referenceId, angles, cuts };
}

export function angleById(sequence: MulticamSequence, angleId: string): MulticamAngle | null {
  return sequence.angles.find((angle) => angle.id === angleId) ?? null;
}

export function activeCut(sequence: MulticamSequence, time: number): MulticamCut | null {
  if (sequence.cuts.length === 0) return null;
  let chosen = sequence.cuts[0];
  for (const cut of sequence.cuts) {
    if (cut.time <= time + 1e-6) chosen = cut;
    else break;
  }
  return chosen;
}

export function activeAngle(sequence: MulticamSequence, time: number): MulticamAngle | null {
  const cut = activeCut(sequence, time);
  if (!cut) return sequence.angles[0] ?? null;
  return angleById(sequence, cut.angleId) ?? sequence.angles[0] ?? null;
}

/**
 * Record a camera change at `time`.
 * A switch on the same frame replaces that cut. Adjacent identical angles collapse.
 * Later cuts stay, which is how a live multicam pass keeps cuts you already made.
 */
export function switchAngle(
  sequence: MulticamSequence,
  time: number,
  angleId: string,
  frameRate = 30,
): MulticamSequence {
  if (!angleById(sequence, angleId)) return sequence;
  const snapped = snapToFrame(Math.max(0, time), frameRate);
  const frame = 1 / (frameRate >= 1 ? frameRate : 30);
  const cuts = sequence.cuts.map((cut) => ({ ...cut }));
  const sameFrame = cuts.findIndex((cut) => Math.abs(cut.time - snapped) <= frame * 0.5 + 1e-6);
  if (sameFrame >= 0) cuts[sameFrame] = { ...cuts[sameFrame], angleId };
  else cuts.push({ id: `cut_${snapped.toFixed(3)}_${angleId}`, time: snapped, angleId });
  cuts.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const merged: MulticamCut[] = [];
  for (const cut of cuts) {
    const previous = merged[merged.length - 1];
    if (previous && previous.angleId === cut.angleId) continue;
    merged.push(cut);
  }
  if (merged.length === 0 || merged[0].time > 0) {
    merged.unshift({ id: `${sequence.id}_open`, time: 0, angleId });
  }
  return { ...sequence, cuts: merged };
}

export function applySyncOffsets(
  sequence: MulticamSequence,
  offsets: readonly { id: string; offsetSec: number; confidence: number }[],
): MulticamSequence {
  const byId = new Map(offsets.map((offset) => [offset.id, offset]));
  return {
    ...sequence,
    angles: sequence.angles.map((angle) => {
      if (angle.id === sequence.referenceId) return { ...angle, syncOffset: 0, confidence: 1 };
      const found = byId.get(angle.id);
      if (!found) return angle;
      return {
        ...angle,
        syncOffset: clamp(found.offsetSec, -12 * 3600, 12 * 3600),
        confidence: clamp(found.confidence, -1, 1),
      };
    }),
  };
}

export function refineCutTime(
  time: number,
  envelope: EnergyEnvelope,
  options?: { windowSec?: number; frameRate?: number; mode?: 'gap' | 'onset' },
): number {
  const frameRate = options?.frameRate ?? 30;
  const windowSec = clamp(options?.windowSec ?? 0.4, 1 / 60, 2);
  const rate = envelope.sampleRate > 0 ? envelope.sampleRate : 100;
  const mode = options?.mode ?? 'gap';
  const start = Math.max(0, time - windowSec);
  const end = time + windowSec;
  const first = Math.max(0, Math.floor(start * rate));
  const last = Math.min(envelope.values.length - 1, Math.ceil(end * rate));
  if (last - first < 2) return snapToFrame(time, frameRate);
  if (mode === 'onset') {
    let bestIndex = first;
    let bestRise = Number.NEGATIVE_INFINITY;
    for (let index = first + 1; index <= last; index += 1) {
      const rise = (envelope.values[index] ?? 0) - (envelope.values[index - 1] ?? 0);
      if (rise > bestRise) {
        bestRise = rise;
        bestIndex = index;
      }
    }
    return snapToFrame(bestIndex / rate, frameRate);
  }
  let bestIndex = first;
  let bestEnergy = Number.POSITIVE_INFINITY;
  for (let index = first; index <= last; index += 1) {
    const energy = envelope.values[index] ?? 0;
    if (energy < bestEnergy) {
      bestEnergy = energy;
      bestIndex = index;
    }
  }
  return snapToFrame(bestIndex / rate, frameRate);
}

/** Nudge every cut after the opening one toward a pause or an onset, without crossing its neighbors. */
export function refineCuts(
  sequence: MulticamSequence,
  envelope: EnergyEnvelope,
  options?: { windowSec?: number; frameRate?: number; mode?: 'gap' | 'onset' },
): MulticamSequence {
  const frameRate = options?.frameRate ?? 30;
  const frame = 1 / (frameRate >= 1 ? frameRate : 30);
  const cuts = sequence.cuts.map((cut) => ({ ...cut }));
  for (let index = 1; index < cuts.length; index += 1) {
    const previous = cuts[index - 1];
    const next = cuts[index + 1];
    const proposed = refineCutTime(cuts[index].time, envelope, options);
    const lower = previous.time + frame;
    const upper = next ? next.time - frame : proposed + frame;
    cuts[index] = { ...cuts[index], time: clamp(proposed, lower, Math.max(lower, upper)) };
  }
  return { ...sequence, cuts };
}

/** Source time of an angle at a sequence time. Sync offset moves the clip on the timeline. */
export function sourceTimeAt(angle: MulticamAngle, sequenceTime: number): number {
  return Math.max(0, sequenceTime - angle.syncOffset);
}

export function multicamToClips(
  sequence: MulticamSequence,
  duration: number,
  trackId: string,
  idFor: (index: number, cut: MulticamCut) => string = (_index, cut) => `mc_${cut.id}`,
): TimelineClip[] {
  const end = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const clips: TimelineClip[] = [];
  sequence.cuts.forEach((cut, index) => {
    const angle = angleById(sequence, cut.angleId);
    if (!angle) return;
    const start = cut.time;
    const stop = sequence.cuts[index + 1]?.time ?? end;
    if (stop - start <= 0.001 || start >= end) return;
    const inPoint = sourceTimeAt(angle, start);
    const outPoint = sourceTimeAt(angle, Math.min(stop, end));
    if (outPoint - inPoint <= 0.001) return;
    clips.push({
      id: idFor(index, cut),
      src: angle.src,
      trackId,
      startTime: start,
      endTime: Math.min(stop, end),
      inPoint,
      outPoint,
      linkId: null,
    });
  });
  return clips;
}

export function multicamTrack(id = 'v-multicam'): TimelineTrack {
  return { id, type: 'video', name: 'Multicam', muted: false, locked: false };
}

/** RMS energy at `envelopeRate` so cut refinement can see pauses and onsets. */
export function energyEnvelope(samples: ArrayLike<number>, sampleRate: number, envelopeRate = 100): EnergyEnvelope {
  const rate = sampleRate > 0 ? sampleRate : envelopeRate;
  const ratio = Math.max(1, rate / envelopeRate);
  const length = Math.max(0, Math.floor(samples.length / ratio));
  const values = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      const sample = samples[cursor] ?? 0;
      sum += sample * sample;
    }
    values[index] = Math.sqrt(sum / (end - start));
  }
  return { sampleRate: envelopeRate, values };
}

export function mediaBaseName(filePath: string): string {
  const parts = filePath.split(/[/\\]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? filePath;
}
