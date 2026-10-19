/**
 * Pure proxy decisions: when to build a proxy, which files to evict, and how
 * a moved camera original maps back onto a cache entry. No filesystem access.
 */

export type ProxyScale = 'full' | 'half' | 'quarter';

export interface AutoProxyRules {
  enabled: boolean;
  /** Long edge at or below this stays on the original when the codec is light. */
  fullResLongEdge: number;
  /** Long edge above full-res and at or below this uses a half proxy. Larger frames use quarter. */
  halfResLongEdge: number;
  /** Codecs that are expensive for the program monitor even at 1080p. */
  heavyCodecs: readonly string[];
  /** Files longer than this, above the full-res edge, are proxied. */
  longDurationSec: number;
  /** Bytes above which a light 1080p file is still proxied. */
  largeFileBytes: number;
}

export interface ProxySourceProfile {
  width: number;
  height: number;
  durationSec: number;
  videoCodec: string;
  fileBytes: number;
}

export interface ProxyDecision {
  required: boolean;
  scale: ProxyScale;
  reason: string;
}

export interface CacheGroup {
  id: string;
  completeBytes: number;
  partialBytes: number;
  sidecarBytes: number;
  lastUsedMs: number;
  hasComplete: boolean;
  pinned: boolean;
}

export interface CacheCleanupPlan {
  deleteIds: string[];
  trimPartialIds: string[];
  freedBytes: number;
  remainingBytes: number;
}

export interface MediaRelinkNeed {
  id: string;
  name: string;
  size: number | null;
  durationSec: number | null;
}

export interface MediaRelinkCandidate {
  id: string;
  name: string;
  size: number | null;
  durationSec: number | null;
}

export interface MediaRelinkMatch {
  needId: string;
  candidateId: string;
  score: number;
  reason: string;
}

export interface ProxyRelinkEntry {
  id: string;
  sourcePath: string;
  sourceSize: number | null;
  scale: ProxyScale;
}

export interface ProxyRelinkTarget {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface ProxyRelinkMove {
  id: string;
  toPath: string;
  toSize: number;
  toMtimeMs: number;
  scale: ProxyScale;
  score: number;
}

export const DEFAULT_CACHE_LIMIT_BYTES = 20 * 1024 * 1024 * 1024;
export const MIN_CACHE_LIMIT_BYTES = 256 * 1024 * 1024;
export const MAX_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024 * 1024;

export function defaultAutoProxyRules(): AutoProxyRules {
  return {
    enabled: true,
    fullResLongEdge: 1920,
    halfResLongEdge: 2560,
    heavyCodecs: ['hevc', 'h265', 'av1', 'prores', 'vp9', 'cfhd', 'dnxhd', 'dnxhr'],
    longDurationSec: 15 * 60,
    largeFileBytes: 8 * 1024 * 1024 * 1024,
  };
}

export function clampCacheLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CACHE_LIMIT_BYTES;
  return Math.min(MAX_CACHE_LIMIT_BYTES, Math.max(MIN_CACHE_LIMIT_BYTES, Math.round(value)));
}

function baseName(filePath: string): string {
  const parts = filePath.split(/[/\\]/).filter((part) => part.length > 0);
  return (parts[parts.length - 1] ?? filePath).toLowerCase();
}

function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export function recommendProxy(profile: ProxySourceProfile, rules: AutoProxyRules = defaultAutoProxyRules()): ProxyDecision {
  const longEdge = Math.max(profile.width, profile.height);
  const codec = profile.videoCodec.toLowerCase();
  const heavy = rules.heavyCodecs.some((item) => codec.includes(item));
  if (!rules.enabled) {
    return { required: false, scale: 'full', reason: 'Auto proxy is off. Playback uses the original.' };
  }
  if (!(profile.width >= 2) || !(profile.height >= 2)) {
    return { required: false, scale: 'full', reason: 'Frame size is not available yet.' };
  }
  let scale: ProxyScale = 'full';
  if (longEdge > rules.halfResLongEdge) scale = 'quarter';
  else if (longEdge > rules.fullResLongEdge) scale = 'half';
  else if (heavy) scale = 'half';

  if (scale === 'quarter') {
    return { required: true, scale, reason: `${longEdge}px frames play back at quarter resolution.` };
  }
  if (heavy && longEdge > 1280) {
    return { required: true, scale, reason: `${codec || 'This codec'} is decoded from a ${scale} proxy.` };
  }
  if (profile.durationSec >= rules.longDurationSec && longEdge > 1280) {
    return { required: true, scale: scale === 'full' ? 'half' : scale, reason: 'Long media uses a proxy so scrubbing stays on intra frames.' };
  }
  if (profile.fileBytes >= rules.largeFileBytes && longEdge > 1280) {
    return { required: true, scale: scale === 'full' ? 'half' : scale, reason: 'Large media uses a proxy and the export stays on the original.' };
  }
  if (scale !== 'full') {
    return { required: true, scale, reason: `${longEdge}px frames play back at ${scale} resolution.` };
  }
  return { required: false, scale: 'full', reason: 'This file can play from the original.' };
}

export function planCacheCleanup(groups: readonly CacheGroup[], maxBytes: number): CacheCleanupPlan {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_CACHE_LIMIT_BYTES;
  const deleteIds: string[] = [];
  const trimPartialIds: string[] = [];
  let freed = 0;
  const survivors: CacheGroup[] = [];
  for (const group of groups) {
    if (group.partialBytes > 0) {
      if (group.hasComplete) trimPartialIds.push(group.id);
      freed += group.partialBytes;
    }
    if (!group.hasComplete) {
      deleteIds.push(group.id);
      freed += group.completeBytes + group.sidecarBytes;
      continue;
    }
    survivors.push(group);
  }
  const ranked = [...survivors].sort((a, b) => a.lastUsedMs - b.lastUsedMs || a.id.localeCompare(b.id));
  let remaining = ranked.reduce((sum, group) => sum + group.completeBytes + group.sidecarBytes, 0);
  for (const group of ranked) {
    if (remaining <= limit) break;
    if (group.pinned) continue;
    deleteIds.push(group.id);
    const bytes = group.completeBytes + group.sidecarBytes;
    remaining -= bytes;
    freed += bytes;
  }
  return { deleteIds, trimPartialIds, freedBytes: freed, remainingBytes: Math.max(0, remaining) };
}

function sizeScore(need: number | null, candidate: number | null, exactPoints: number): number {
  if (need === null || candidate === null) return 0;
  if (need === candidate) return exactPoints;
  const delta = Math.abs(need - candidate);
  const tolerance = Math.max(1, need * 0.01);
  return delta <= tolerance ? Math.round(exactPoints * 0.6) : 0;
}

export function planMediaRelink(
  needs: readonly MediaRelinkNeed[],
  candidates: readonly MediaRelinkCandidate[],
): MediaRelinkMatch[] {
  const pairs: MediaRelinkMatch[] = [];
  for (const need of needs) {
    const needName = need.name.toLowerCase();
    const needStem = stem(needName);
    for (const candidate of candidates) {
      const candidateName = candidate.name.toLowerCase();
      let score = 0;
      const reasons: string[] = [];
      if (needName && needName === candidateName) {
        score += 70;
        reasons.push('file name');
      } else if (needStem && needStem === stem(candidateName)) {
        score += 45;
        reasons.push('file stem');
      }
      const sized = sizeScore(need.size, candidate.size, 30);
      if (sized > 0) {
        score += sized;
        reasons.push('file size');
      }
      const timed = sizeScore(need.durationSec, candidate.durationSec, 25);
      if (timed > 0) {
        score += timed;
        reasons.push('duration');
      }
      if (score >= 70) pairs.push({ needId: need.id, candidateId: candidate.id, score, reason: reasons.join(', ') });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.needId.localeCompare(b.needId));
  const usedNeeds = new Set<string>();
  const usedCandidates = new Set<string>();
  const matches: MediaRelinkMatch[] = [];
  for (const pair of pairs) {
    if (usedNeeds.has(pair.needId) || usedCandidates.has(pair.candidateId)) continue;
    usedNeeds.add(pair.needId);
    usedCandidates.add(pair.candidateId);
    matches.push(pair);
  }
  return matches;
}

export function planProxyRelink(
  entries: readonly ProxyRelinkEntry[],
  targets: readonly ProxyRelinkTarget[],
): ProxyRelinkMove[] {
  const pairs: ProxyRelinkMove[] = [];
  for (const entry of entries) {
    const entryName = baseName(entry.sourcePath);
    for (const target of targets) {
      const targetName = baseName(target.path);
      if (!entryName || entryName !== targetName) continue;
      let score = 70;
      if (entry.sourceSize !== null && entry.sourceSize === target.size) score += 30;
      else if (entry.sourceSize !== null) continue;
      pairs.push({
        id: entry.id,
        toPath: target.path,
        toSize: target.size,
        toMtimeMs: target.mtimeMs,
        scale: entry.scale,
        score,
      });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const used = new Set<string>();
  const moves: ProxyRelinkMove[] = [];
  for (const pair of pairs) {
    const key = `${pair.id}`;
    if (used.has(key)) continue;
    used.add(key);
    moves.push(pair);
  }
  return moves;
}
