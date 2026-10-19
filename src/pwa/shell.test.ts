import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { webInstallHeadTags } from './installMeta';
import { SHELL_CACHE, SHELL_URLS, shouldRegisterServiceWorker } from './shell';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('installable web shell', () => {
  it('registers a worker only for a production browser or Capacitor build', () => {
    expect(shouldRegisterServiceWorker({ production: true, kind: 'web', supported: true })).toBe(true);
    expect(shouldRegisterServiceWorker({ production: true, kind: 'capacitor', supported: true })).toBe(true);
    expect(shouldRegisterServiceWorker({ production: true, kind: 'electron', supported: true })).toBe(false);
    expect(shouldRegisterServiceWorker({ production: false, kind: 'web', supported: true })).toBe(false);
    expect(shouldRegisterServiceWorker({ production: true, kind: 'web', supported: false })).toBe(false);
  });

  it('precaches the same shell the service worker lists', () => {
    const worker = readFileSync(path.join(root, 'public/sw.js'), 'utf8');
    expect(worker).toContain(SHELL_CACHE);
    for (const url of SHELL_URLS) expect(worker).toContain(url);
    const manifest = JSON.parse(readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8')) as {
      display: string;
      start_url: string;
      icons: { src: string; sizes: string }[];
    };
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/icons/icon-512.png',
    ]);
  });

  it('is set up as a Vercel static site', () => {
    const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8')) as {
      buildCommand: string;
      outputDirectory: string;
    };
    expect(vercel.buildCommand).toBe('npm run build:web');
    expect(vercel.outputDirectory).toBe('dist');
  });

  it('adds the manifest only to the web build', () => {
    expect(webInstallHeadTags(false)).toEqual([]);
    const tags = webInstallHeadTags(true);
    expect(tags.some((tag) => tag.attrs.href === '/manifest.webmanifest')).toBe(true);
    expect(tags.some((tag) => tag.attrs.href === '/icons/apple-touch-icon.png')).toBe(true);
  });
});
