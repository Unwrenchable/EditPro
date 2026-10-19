/**
 * On-demand downloads for offline AI models and tools.
 * Files land under the app user-data directory. Nothing here is bundled.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from '../security.js';

const ALLOWED_HOSTS = [
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'cas-bridge.xethub.hf.co',
];

export function isAllowedDownloadUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    const stream = handle.createReadStream();
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

/** Size check for status. Downloads still verify the checksum before use. */
export async function fileSized(filePath: string, bytes: number): Promise<boolean> {
  try {
    const info = await fs.stat(filePath);
    return info.isFile() && info.size === bytes;
  } catch {
    return false;
  }
}

export async function fileReady(filePath: string, sha256: string, bytes: number): Promise<boolean> {
  try {
    const info = await fs.stat(filePath);
    if (!info.isFile() || info.size !== bytes) return false;
    return (await sha256File(filePath)) === sha256;
  } catch {
    return false;
  }
}

export interface DownloadOptions {
  url: string;
  destination: string;
  sha256: string;
  expectedBytes?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (loaded: number, total: number | null) => void;
}

export async function downloadVerified(options: DownloadOptions): Promise<'cached' | 'downloaded'> {
  if (!isAllowedDownloadUrl(options.url)) {
    throw new Error('Refusing to download from an unexpected address');
  }
  if (
    options.expectedBytes
    && options.expectedBytes > 0
    && await fileReady(options.destination, options.sha256, options.expectedBytes)
  ) {
    return 'cached';
  }
  const parent = path.dirname(options.destination);
  await fs.mkdir(parent, { recursive: true });
  const temp = `${options.destination}.partial`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(options.url, { signal: options.signal, redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status})`);
  }
  const finalUrl = response.url;
  if (finalUrl && !isAllowedDownloadUrl(finalUrl)) {
    throw new Error('Refusing a download that redirected off the model host');
  }
  const totalHeader = response.headers.get('content-length');
  const total = totalHeader ? Number(totalHeader) : null;
  const handle = await fs.open(temp, 'w');
  let loaded = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const bytes = Buffer.from(step.value);
      await handle.write(bytes);
      loaded += bytes.length;
      options.onProgress?.(loaded, Number.isFinite(total ?? NaN) ? total : null);
    }
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
  const digest = await sha256File(temp);
  if (digest !== options.sha256) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw new Error('Downloaded file did not match the expected checksum');
  }
  await fs.rename(temp, options.destination);
  return 'downloaded';
}

export function pathInside(root: string, ...parts: string[]): string {
  const destination = path.resolve(root, ...parts);
  if (destination !== path.resolve(root) && !isPathInside(root, destination)) {
    throw new Error('Refusing a path outside the model folder');
  }
  return destination;
}
