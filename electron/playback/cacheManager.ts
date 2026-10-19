/**
 * Proxy cache inventory, size limit, and relink.
 * Files outside the cache root, and anything that is not a proxy hash name, are left alone.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  clampCacheLimit,
  DEFAULT_CACHE_LIMIT_BYTES,
  planCacheCleanup,
  planProxyRelink,
  type CacheGroup,
  type ProxyRelinkEntry,
  type ProxyRelinkTarget,
  type ProxyScale,
} from './cachePolicy.js';
import {
  isInsideProxyCache,
  isPlaybackScale,
  parseProxySidecar,
  proxyCacheFileName,
  proxyOutputPaths,
  serializeProxySidecar,
  type ProxySidecar,
} from './proxyPlan.js';

export interface CachePolicyFile {
  maxBytes: number;
  auto: boolean;
}

export interface CacheInventoryItem {
  id: string;
  bytes: number;
  lastUsedMs: number;
  partial: boolean;
  sourceName: string | null;
  scale: ProxyScale | null;
}

export interface CacheStatus {
  usedBytes: number;
  maxBytes: number;
  auto: boolean;
  items: number;
  partials: number;
  entries: CacheInventoryItem[];
}

const HASH = /^[a-f0-9]{64}$/;
const POLICY_NAME = 'policy.json';

export function defaultCachePolicy(): CachePolicyFile {
  return { maxBytes: DEFAULT_CACHE_LIMIT_BYTES, auto: true };
}

export async function readCachePolicy(root: string): Promise<CachePolicyFile> {
  try {
    const raw = await fs.readFile(path.join(root, POLICY_NAME), 'utf8');
    const parsed = JSON.parse(raw) as { maxBytes?: unknown; auto?: unknown };
    return {
      maxBytes: clampCacheLimit(typeof parsed.maxBytes === 'number' ? parsed.maxBytes : DEFAULT_CACHE_LIMIT_BYTES),
      auto: parsed.auto !== false,
    };
  } catch {
    return defaultCachePolicy();
  }
}

export async function writeCachePolicy(root: string, policy: CachePolicyFile): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const next: CachePolicyFile = { maxBytes: clampCacheLimit(policy.maxBytes), auto: policy.auto !== false };
  await fs.writeFile(path.join(root, POLICY_NAME), JSON.stringify(next), 'utf8');
}

interface GroupFiles {
  id: string;
  complete: string | null;
  partial: string | null;
  sidecar: string | null;
  completeBytes: number;
  partialBytes: number;
  sidecarBytes: number;
  lastUsedMs: number;
}

async function listGroups(root: string): Promise<Map<string, GroupFiles>> {
  const groups = new Map<string, GroupFiles>();
  let names: string[] = [];
  try {
    names = await fs.readdir(root);
  } catch {
    return groups;
  }
  const ensure = (id: string): GroupFiles => {
    const existing = groups.get(id);
    if (existing) return existing;
    const created: GroupFiles = {
      id,
      complete: null,
      partial: null,
      sidecar: null,
      completeBytes: 0,
      partialBytes: 0,
      sidecarBytes: 0,
      lastUsedMs: 0,
    };
    groups.set(id, created);
    return created;
  };
  for (const name of names) {
    if (name === POLICY_NAME) continue;
    const partial = /^([a-f0-9]{64})\.part\.mp4$/.exec(name);
    const finalName = /^([a-f0-9]{64})\.mp4$/.exec(name);
    const sidecar = /^([a-f0-9]{64})\.json$/.exec(name);
    const id = partial?.[1] ?? finalName?.[1] ?? sidecar?.[1];
    if (!id || !HASH.test(id)) continue;
    const full = path.join(root, name);
    if (!isInsideProxyCache(root, full)) continue;
    let stat;
    try {
      stat = await fs.lstat(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const group = ensure(id);
    group.lastUsedMs = Math.max(group.lastUsedMs, stat.mtimeMs);
    if (partial) {
      group.partial = full;
      group.partialBytes += stat.size;
    } else if (finalName) {
      group.complete = full;
      group.completeBytes += stat.size;
    } else if (sidecar) {
      group.sidecar = full;
      group.sidecarBytes += stat.size;
    }
  }
  return groups;
}

async function readEntry(group: GroupFiles): Promise<ProxyRelinkEntry | null> {
  if (!group.sidecar || !group.complete) return null;
  try {
    const raw = await fs.readFile(group.sidecar, 'utf8');
    const sidecar = parseProxySidecar(raw);
    if (!sidecar || !isPlaybackScale(sidecar.scale)) return null;
    return {
      id: group.id,
      sourcePath: sidecar.sourcePath,
      sourceSize: typeof sidecar.sourceSize === 'number' ? sidecar.sourceSize : null,
      scale: sidecar.scale,
    };
  } catch {
    return null;
  }
}

function sourceName(sourcePath: string | null): string | null {
  if (!sourcePath) return null;
  const parts = sourcePath.split(/[/\\]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? null;
}

export async function inspectProxyCache(root: string): Promise<CacheStatus> {
  const policy = await readCachePolicy(root);
  const groups = await listGroups(root);
  const entries: CacheInventoryItem[] = [];
  let used = 0;
  let partials = 0;
  for (const group of groups.values()) {
    const bytes = group.completeBytes + group.partialBytes + group.sidecarBytes;
    used += bytes;
    if (group.partial) partials += 1;
    let sidecar: ProxySidecar | null = null;
    if (group.sidecar) {
      try {
        sidecar = parseProxySidecar(await fs.readFile(group.sidecar, 'utf8'));
      } catch {
        sidecar = null;
      }
    }
    entries.push({
      id: group.id,
      bytes,
      lastUsedMs: group.lastUsedMs,
      partial: !group.complete,
      sourceName: sourceName(sidecar?.sourcePath ?? null),
      scale: sidecar && isPlaybackScale(sidecar.scale) ? sidecar.scale : null,
    });
  }
  entries.sort((a, b) => b.lastUsedMs - a.lastUsedMs);
  return {
    usedBytes: used,
    maxBytes: policy.maxBytes,
    auto: policy.auto,
    items: entries.length,
    partials,
    entries,
  };
}

async function unlinkInside(root: string, filePath: string | null): Promise<number> {
  if (!filePath || !isInsideProxyCache(root, filePath)) return 0;
  try {
    const stat = await fs.lstat(filePath);
    await fs.unlink(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

export async function cleanupProxyCache(root: string, pinnedIds: readonly string[] = []): Promise<CacheStatus> {
  await fs.mkdir(root, { recursive: true });
  const policy = await readCachePolicy(root);
  const groups = await listGroups(root);
  const pinned = new Set(pinnedIds);
  const planned: CacheGroup[] = [...groups.values()].map((group) => ({
    id: group.id,
    completeBytes: group.completeBytes,
    partialBytes: group.partialBytes,
    sidecarBytes: group.sidecarBytes,
    lastUsedMs: group.lastUsedMs,
    hasComplete: group.complete !== null && group.completeBytes > 0,
    pinned: pinned.has(group.id),
  }));
  const plan = planCacheCleanup(planned, policy.maxBytes);
  const drop = new Set(plan.deleteIds);
  const trim = new Set(plan.trimPartialIds);
  for (const group of groups.values()) {
    if (drop.has(group.id)) {
      await unlinkInside(root, group.complete);
      await unlinkInside(root, group.partial);
      await unlinkInside(root, group.sidecar);
      continue;
    }
    if (trim.has(group.id)) await unlinkInside(root, group.partial);
  }
  return inspectProxyCache(root);
}

export async function relinkProxyCache(root: string, targets: readonly ProxyRelinkTarget[]): Promise<{ moved: number; skipped: number }> {
  const groups = await listGroups(root);
  const entries: ProxyRelinkEntry[] = [];
  for (const group of groups.values()) {
    const entry = await readEntry(group);
    if (entry) entries.push(entry);
  }
  const moves = planProxyRelink(entries, targets);
  let moved = 0;
  let skipped = 0;
  for (const move of moves) {
    const group = groups.get(move.id);
    if (!group?.complete || !group.sidecar) {
      skipped += 1;
      continue;
    }
    const nextId = proxyCacheFileName({
      sourcePath: move.toPath,
      size: move.toSize,
      mtimeMs: move.toMtimeMs,
      scale: move.scale,
    });
    if (!HASH.test(nextId)) {
      skipped += 1;
      continue;
    }
    if (nextId === group.id) {
      moved += 1;
      continue;
    }
    const nextPaths = proxyOutputPaths(root, nextId);
    if (groups.has(nextId)) {
      skipped += 1;
      continue;
    }
    try {
      await fs.lstat(nextPaths.finalPath);
      skipped += 1;
      continue;
    } catch {
      // The destination hash is free.
    }
    let sidecar: ProxySidecar | null = null;
    try {
      sidecar = parseProxySidecar(await fs.readFile(group.sidecar, 'utf8'));
    } catch {
      sidecar = null;
    }
    if (!sidecar) {
      skipped += 1;
      continue;
    }
    const rewritten: ProxySidecar = {
      ...sidecar,
      sourcePath: move.toPath,
      sourceSize: move.toSize,
      sourceMtimeMs: move.toMtimeMs,
    };
    try {
      await fs.rename(group.complete, nextPaths.finalPath);
      await fs.writeFile(nextPaths.sidecarPath, serializeProxySidecar(rewritten), 'utf8');
      await unlinkInside(root, group.sidecar);
      if (group.partial) await unlinkInside(root, group.partial);
      moved += 1;
    } catch {
      skipped += 1;
    }
  }
  return { moved, skipped };
}
