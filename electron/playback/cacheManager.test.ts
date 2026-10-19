/**
 * @vitest-environment node
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupProxyCache, inspectProxyCache, relinkProxyCache, writeCachePolicy } from './cacheManager.js';
import { proxyCacheFileName, proxyOutputPaths, serializeProxySidecar, PROXY_FORMAT_VERSION } from './proxyPlan.js';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'editpro-cache-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function plant(root: string, sourcePath: string, scale: 'half' | 'full', bytes: number, mtimeMs: number): Promise<string> {
  const id = proxyCacheFileName({ sourcePath, size: bytes, mtimeMs, scale });
  const paths = proxyOutputPaths(root, id);
  await fs.writeFile(paths.finalPath, Buffer.alloc(bytes, 1));
  await fs.writeFile(paths.sidecarPath, serializeProxySidecar({
    version: PROXY_FORMAT_VERSION,
    sourcePath,
    scale,
    width: 960,
    height: 540,
    fps: 24,
    durationSec: 2,
    videoCodec: 'h264',
    sourceSize: bytes,
    sourceMtimeMs: mtimeMs,
  }));
  const stamp = new Date(mtimeMs);
  await fs.utimes(paths.finalPath, stamp, stamp);
  return id;
}

describe('proxy cache manager', () => {
  it('removes unfinished proxies and stale partials while keeping a finished one', async () => {
    const root = await makeRoot();
    await writeCachePolicy(root, { maxBytes: 256 * 1024 * 1024, auto: false });
    const keep = await plant(root, '/films/new.mov', 'half', 180, 5_000);
    await fs.writeFile(path.join(root, `${keep}.part.mp4`), Buffer.alloc(40));
    const orphan = 'ab'.repeat(32);
    await fs.writeFile(path.join(root, `${orphan}.part.mp4`), Buffer.alloc(24));
    const cleaned = await cleanupProxyCache(root, [keep]);
    expect(cleaned.entries.some((entry) => entry.id === keep)).toBe(true);
    expect(cleaned.entries.some((entry) => entry.id === orphan)).toBe(false);
    await expect(fs.access(path.join(root, `${keep}.part.mp4`))).rejects.toThrow();
    const policy = JSON.parse(await fs.readFile(path.join(root, 'policy.json'), 'utf8')) as { auto: boolean };
    expect(policy.auto).toBe(false);
  });

  it('renames a proxy when the camera file is relinked and the size matches', async () => {
    const root = await makeRoot();
    const media = await fs.mkdtemp(path.join(os.tmpdir(), 'editpro-media-'));
    roots.push(media);
    const source = '/volumes/card/A001.mov';
    const oldId = await plant(root, source, 'half', 64, 100);
    const target = path.join(media, 'A001.mov');
    await fs.writeFile(target, Buffer.alloc(64));
    const result = await relinkProxyCache(root, [{ path: target, size: 64, mtimeMs: 250 }]);
    expect(result.moved).toBe(1);
    const status = await inspectProxyCache(root);
    expect(status.entries.map((entry) => entry.id)).not.toContain(oldId);
    expect(status.entries[0]?.sourceName).toBe('A001.mov');
  });
});
