import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { loadReleaseAssets, mountDownloadPage } from './page';
import {
  IOS_STEPS,
  chooseReleaseAssets,
  detectOs,
  downloadCards,
} from './offers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('download offers', () => {
  it('detects the host operating system', () => {
    expect(detectOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(detectOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac');
    expect(detectOs('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(detectOs('Mozilla/5.0 (Linux; Android 14)')).toBe('android');
    expect(detectOs('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(detectOs('Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit Mobile')).toBe('ios');
  });

  it('picks Windows, Mac, Linux, and Android files from a GitHub release', () => {
    const assets = [
      { name: 'EditPro-1.0.0-mac.zip', browser_download_url: 'https://example.com/mac.zip' },
      { name: 'EditPro-1.0.0.dmg', browser_download_url: 'https://example.com/mac.dmg' },
      { name: 'EditPro Setup 1.0.0.exe', browser_download_url: 'https://example.com/win.exe' },
      { name: 'EditPro-1.0.0.AppImage', browser_download_url: 'https://example.com/linux.AppImage' },
      { name: 'EditPro-1.0.0.deb', browser_download_url: 'https://example.com/linux.deb' },
      { name: 'EditPro-android.apk', browser_download_url: 'https://example.com/app.apk' },
    ];
    const picked = chooseReleaseAssets(assets);
    expect(picked.windows?.name).toMatch(/\.exe$/);
    expect(picked.mac?.name).toMatch(/\.dmg$/);
    expect(picked.linux?.name).toMatch(/AppImage$/);
    expect(picked.android?.name).toMatch(/\.apk$/);
    const cards = downloadCards('windows', assets);
    expect(cards.find((card) => card.id === 'windows')).toMatchObject({
      primary: true,
      href: 'https://example.com/win.exe',
    });
    expect(cards.find((card) => card.id === 'mac')?.primary).toBe(false);
    expect(cards.find((card) => card.id === 'ios')?.action).toBe('ios');
  });

  it('points missing installers at the releases page', () => {
    const windows = downloadCards('linux', []).find((card) => card.id === 'windows');
    expect(windows?.href).toBe('https://github.com/Unwrenchable/EditPro/releases/latest');
    expect(windows?.detail).toMatch(/\.exe/);
  });

  it('renders the detected device, a download, the install button, and iOS steps', () => {
    document.body.innerHTML = `
      <p id="download-detected"></p>
      <div id="download-cards"></div>
      <p id="install-status"></p>
      <ol id="ios-step-list"></ol>
    `;
    const onInstall = vi.fn();
    mountDownloadPage(document, {
      os: 'ios',
      assets: [{ name: 'EditPro.dmg', browser_download_url: 'https://example.com/EditPro.dmg' }],
      installed: false,
      canPrompt: false,
      onInstall,
    });
    expect(document.getElementById('download-detected')?.textContent).toContain('iPhone or iPad');
    expect(document.querySelector('[data-card="mac"] a')?.getAttribute('href')).toBe('https://example.com/EditPro.dmg');
    expect(document.querySelector('[data-card="ios"]')?.className).toContain('download-card-primary');
    const install = document.querySelector('[data-card="pwa"] button');
    expect(install?.textContent).toBe('See Add to Home Screen');
    install?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('ios-step-list')?.textContent).toContain(IOS_STEPS[2]);
  });

  it('treats a failed release lookup as no files', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    expect(await loadReleaseAssets(fetchImpl as typeof fetch)).toEqual([]);
  });

  it('is a second page of the web build and part of the offline shell', () => {
    const html = readFileSync(path.join(root, 'download.html'), 'utf8');
    expect(html).toContain('/manifest.webmanifest');
    expect(html).toContain('Add to Home Screen');
    const config = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
    expect(config).toContain("download: path.resolve(root, 'download.html')");
    const worker = readFileSync(path.join(root, 'public/sw.js'), 'utf8');
    expect(worker).toContain('/download.html');
  });
});
