import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  APP_ORIGIN,
  FileAccessGrants,
  buildContentSecurityPolicy,
  canonicalizePath,
  contentTypeForPath,
  decodeImageDataUrl,
  isAllowedAppNavigation,
  isNavigationAllowed,
  isPathInside,
  isTrustedIpcFrame,
  isTrustedIpcOrigin,
  mediaPathsInsideDirectory,
  parseAllowedExternalUrl,
  resolveAppStaticPath,
  sanitizeSaveFileName,
} from './security';

const dev = { isDev: true, devPort: '5173' };
const prod = { isDev: false, devPort: '5173' };

describe('FileAccessGrants', () => {
  it('allows reading only paths granted by an open dialog', () => {
    const grants = new FileAccessGrants();
    const picked = path.resolve('/tmp/editpro/photo.png');
    expect(() => grants.assertCanRead(picked)).toThrow(/open dialog/);
    grants.grantRead(picked);
    expect(grants.assertCanRead(picked)).toBe(canonicalizePath(picked));
  });

  it('does not treat a read grant as permission to write', () => {
    const grants = new FileAccessGrants();
    const picked = path.resolve('/tmp/editpro/photo.png');
    grants.grantRead(picked);
    expect(() => grants.consumeWrite(picked)).toThrow(/save dialog/);
  });

  it('rejects path traversal away from a granted file', () => {
    const grants = new FileAccessGrants();
    const picked = path.resolve('/tmp/editpro/photo.png');
    grants.grantRead(picked);
    expect(() => grants.assertCanRead(`${picked}/../../etc/passwd`)).toThrow(/open dialog/);
    expect(() => grants.assertCanRead(path.resolve('/etc/passwd'))).toThrow(/open dialog/);
  });

  it('consumes a save-dialog grant on write', () => {
    const grants = new FileAccessGrants();
    const destination = path.resolve('/tmp/editpro/out.png');
    grants.grantWrite(destination);
    expect(grants.consumeWrite(destination)).toBe(canonicalizePath(destination));
    expect(() => grants.consumeWrite(destination)).toThrow(/save dialog/);
  });

  it('keeps a write grant for repeated project saves', () => {
    const grants = new FileAccessGrants();
    const destination = path.resolve('/tmp/editpro/Cut.editpro');
    grants.grantWrite(destination);
    expect(grants.assertCanWrite(destination)).toBe(canonicalizePath(destination));
    expect(grants.assertCanWrite(destination)).toBe(canonicalizePath(destination));
  });

  it('omits ephemeral export temp files from the persisted snapshot', () => {
    const grants = new FileAccessGrants();
    const picked = path.resolve('/tmp/editpro/clip.mp4');
    const temp = path.resolve('/tmp/editpro-export/clip.mp4');
    grants.grantRead(picked);
    grants.grantRead(temp, { ephemeral: true });
    grants.grantWrite(path.resolve('/tmp/editpro/out.mp4'));
    expect(grants.snapshot()).toEqual({
      read: [canonicalizePath(picked)],
      write: [canonicalizePath(path.resolve('/tmp/editpro/out.mp4'))],
    });
    expect(grants.hasRead(temp)).toBe(true);
  });

  it('rejects non-strings, empty paths, and NUL bytes', () => {
    const grants = new FileAccessGrants();
    expect(() => grants.assertCanRead(null)).toThrow(/string/);
    expect(() => grants.assertCanRead('')).toThrow(/Invalid path/);
    expect(() => grants.assertCanRead('/tmp/a\0.png')).toThrow(/Invalid path/);
  });
});

describe('path containment for export and projects', () => {
  it('treats the export temp directory as a container and rejects traversal', () => {
    const root = path.resolve('/tmp/editpro-export');
    const inside = path.join(root, 'clip.mp4');
    expect(isPathInside(root, inside)).toBe(true);
    expect(isPathInside(root, root)).toBe(false);
    expect(isPathInside(root, path.resolve('/tmp/editpro-export-other/clip.mp4'))).toBe(false);
    expect(isPathInside(root, path.join(root, '..', 'passwd'))).toBe(false);
  });

  it('grants only media that stays beside the project file', () => {
    const project = path.resolve('/tmp/editpro/demo/Cut.editpro');
    const contents = JSON.stringify({
      media: [
        { path: path.resolve('/tmp/editpro/demo/a.mp4'), relativePath: 'nested/b.png' },
        { path: path.resolve('/etc/passwd'), relativePath: '../../etc/passwd' },
        { path: '', relativePath: '/etc/passwd' },
      ],
    });
    expect(mediaPathsInsideDirectory(project, contents)).toEqual([
      canonicalizePath(path.resolve('/tmp/editpro/demo/a.mp4')),
      canonicalizePath(path.resolve('/tmp/editpro/demo/nested/b.png')),
    ]);
    expect(mediaPathsInsideDirectory(project, 'not json')).toEqual([]);
  });
});

describe('sanitizeSaveFileName', () => {
  it('keeps a plain export name and drops directory components', () => {
    expect(sanitizeSaveFileName('editpro-export.png')).toBe('editpro-export.png');
    expect(sanitizeSaveFileName('../.ssh/authorized_keys')).toBe('authorized_keys');
    expect(sanitizeSaveFileName('..\\Windows\\system32\\evil.exe')).toBe('evil.exe');
  });

  it('falls back when the name is not a usable file name', () => {
    expect(sanitizeSaveFileName('..')).toBe('editpro-export.png');
    expect(sanitizeSaveFileName('')).toBe('editpro-export.png');
    expect(sanitizeSaveFileName(12)).toBe('editpro-export.png');
    expect(sanitizeSaveFileName('bad\nname.png')).toBe('editpro-export.png');
  });
});

describe('parseAllowedExternalUrl', () => {
  it('allows https and mailto and returns a normalized URL', () => {
    expect(parseAllowedExternalUrl('https://github.com/Unwrenchable/EditPro')).toBe(
      'https://github.com/Unwrenchable/EditPro',
    );
    expect(parseAllowedExternalUrl('HTTPS://Example.COM/docs')).toBe('https://example.com/docs');
    expect(parseAllowedExternalUrl('mailto:editor@example.com')).toBe('mailto:editor@example.com');
    expect(parseAllowedExternalUrl('mailto:editor@example.com?subject=Hi')).toBe(
      'mailto:editor@example.com?subject=Hi',
    );
  });

  it('rejects other schemes and prefix tricks', () => {
    expect(parseAllowedExternalUrl('http://example.com')).toBeNull();
    expect(parseAllowedExternalUrl('file:///etc/passwd')).toBeNull();
    expect(parseAllowedExternalUrl('javascript:alert(1)')).toBeNull();
    expect(parseAllowedExternalUrl('data:text/html,hi')).toBeNull();
    expect(parseAllowedExternalUrl('vbscript:msg')).toBeNull();
    expect(parseAllowedExternalUrl('smb://attacker/share')).toBeNull();
    expect(parseAllowedExternalUrl('https://user:pass@example.com')).toBeNull();
    expect(parseAllowedExternalUrl('https://example.com\n.evil.com')).toBeNull();
    expect(parseAllowedExternalUrl('mailto:editor@example.com\r\nBcc:attacker@evil.com')).toBeNull();
    expect(parseAllowedExternalUrl('mailto:')).toBeNull();
    expect(parseAllowedExternalUrl('mailto:?subject=Hi')).toBeNull();
    expect(parseAllowedExternalUrl('https://example.com\\@evil.com')).toBeNull();
    expect(parseAllowedExternalUrl(42)).toBeNull();
  });
});

describe('navigation and IPC sender', () => {
  it('allows the dev server and the packaged app origin only', () => {
    expect(isAllowedAppNavigation('http://localhost:5173/', dev)).toBe(true);
    expect(isAllowedAppNavigation('http://127.0.0.1:5173/index.html', dev)).toBe(true);
    expect(isAllowedAppNavigation('http://localhost:5174/', dev)).toBe(false);
    expect(isAllowedAppNavigation('https://example.com', dev)).toBe(false);
    expect(isAllowedAppNavigation('http://evil.com@localhost:5173/', dev)).toBe(false);
    expect(isAllowedAppNavigation('app://bundle/index.html', prod)).toBe(true);
    expect(isAllowedAppNavigation('app://evil/index.html', prod)).toBe(false);
    expect(isAllowedAppNavigation('file:///etc/passwd', prod)).toBe(false);
    expect(isAllowedAppNavigation('http://localhost:5173/', prod)).toBe(false);
  });

  it('blocks unexpected navigations but lets DevTools boot', () => {
    expect(isNavigationAllowed('http://localhost:5173/', 'https://evil.example', dev)).toBe(false);
    expect(isNavigationAllowed('http://localhost:5173/', 'devtools://devtools/bundled/inspector.html', dev)).toBe(
      false,
    );
    expect(isNavigationAllowed('', 'devtools://devtools/bundled/inspector.html', dev)).toBe(true);
    expect(
      isNavigationAllowed(
        'devtools://devtools/bundled/inspector.html',
        'devtools://devtools/bundled/devtools_app.html',
        dev,
      ),
    ).toBe(true);
    expect(isNavigationAllowed('devtools://devtools/', 'https://evil.example', dev)).toBe(false);
    expect(isNavigationAllowed(`${APP_ORIGIN}/index.html`, 'file:///tmp/x', prod)).toBe(false);
    expect(isNavigationAllowed(`${APP_ORIGIN}/index.html`, `${APP_ORIGIN}/index.html`, prod)).toBe(true);
  });

  it('accepts IPC only from the top-level app frame', () => {
    expect(
      isTrustedIpcFrame(
        { origin: 'http://localhost:5173', url: 'http://localhost:5173/', parent: null },
        dev,
      ),
    ).toBe(true);
    expect(
      isTrustedIpcFrame(
        { origin: APP_ORIGIN, url: `${APP_ORIGIN}/index.html`, parent: null },
        prod,
      ),
    ).toBe(true);
    expect(isTrustedIpcFrame(null, prod)).toBe(false);
    expect(
      isTrustedIpcFrame({ origin: 'null', url: 'file:///etc/passwd', parent: null }, prod),
    ).toBe(false);
    expect(
      isTrustedIpcFrame(
        { origin: APP_ORIGIN, url: `${APP_ORIGIN}/index.html`, parent: {} },
        prod,
      ),
    ).toBe(false);
    expect(
      isTrustedIpcFrame({ origin: 'https://evil.example', url: 'https://evil.example/', parent: null }, prod),
    ).toBe(false);
    expect(isTrustedIpcOrigin('http://localhost:5174', dev)).toBe(false);
    expect(isTrustedIpcOrigin(APP_ORIGIN, prod)).toBe(true);
  });
});

describe('content security policy', () => {
  it('is strict in production and still allows Vite HMR inline code in development', () => {
    const production = buildContentSecurityPolicy(prod);
    const development = buildContentSecurityPolicy(dev);

    expect(production).toContain("default-src 'self'");
    expect(production).toContain("script-src 'self'");
    expect(production).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(production).not.toContain("style-src 'self' 'unsafe-inline'");
    expect(production).not.toContain('unsafe-eval');
    expect(production).toContain("style-src-attr 'unsafe-inline'");
    expect(production).toContain("object-src 'none'");
    expect(production).toContain("frame-ancestors 'none'");
    expect(production).toContain("connect-src 'none'");
    const meta = buildContentSecurityPolicy({ ...prod, delivery: 'meta' });
    expect(meta).not.toContain('frame-ancestors');
    expect(meta).toContain("script-src 'self'");
    expect(production).toContain('blob:');
    expect(production).toContain("media-src 'self' data: blob: media:");
    expect(production).not.toMatch(/script-src[^;]*media:/);
    expect(production).not.toMatch(/script-src[^;]*data:/);

    expect(development).toContain("script-src 'self' 'unsafe-inline'");
    expect(development).toContain('ws://localhost:5173');
    expect(development).not.toContain('unsafe-eval');
    expect(development).toContain("script-src-attr 'none'");
  });
});

describe('app protocol files', () => {
  const root = path.resolve('/tmp/editpro-dist');

  it('serves files inside the build directory', () => {
    expect(resolveAppStaticPath(root, 'app://bundle/index.html')).toBe(path.join(root, 'index.html'));
    expect(resolveAppStaticPath(root, 'app://bundle/assets/app.js')).toBe(
      path.join(root, 'assets', 'app.js'),
    );
    expect(resolveAppStaticPath(root, 'app://bundle/')).toBe(path.join(root, 'index.html'));
    expect(contentTypeForPath(path.join(root, 'index.html'))).toContain('text/html');
    expect(contentTypeForPath(path.join(root, 'app.js'))).toContain('javascript');
  });

  it('rejects other hosts and paths that escape the build directory', () => {
    expect(resolveAppStaticPath(root, 'app://evil/index.html')).toBeNull();
    expect(resolveAppStaticPath(root, 'file:///etc/passwd')).toBeNull();
    expect(resolveAppStaticPath(root, 'app://user@bundle/index.html')).toBeNull();
    expect(resolveAppStaticPath(root, 'app://bundle/%2e%2e%5c%2e%2e%5csecret')).toBeNull();
    expect(resolveAppStaticPath(root, 'app://bundle/C:/Windows/system32')).toBeNull();
    expect(resolveAppStaticPath(root, 'app://bundle/%00')).toBeNull();
    const collapsed = resolveAppStaticPath(root, 'app://bundle/../../etc/passwd');
    expect(collapsed).toBe(path.join(root, 'etc', 'passwd'));
    expect(collapsed?.startsWith(root)).toBe(true);
  });
});

describe('decodeImageDataUrl', () => {
  it('decodes png, jpeg, and webp data URLs', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    expect(decodeImageDataUrl(dataUrl)).toEqual(png);
    expect(decodeImageDataUrl('data:image/jpeg;base64,aa==').length).toBeGreaterThan(0);
    expect(decodeImageDataUrl('data:image/webp;base64,aa==').length).toBeGreaterThan(0);
  });

  it('rejects non-image and malformed payloads', () => {
    expect(() => decodeImageDataUrl('data:text/html;base64,PGh0bWw+')).toThrow(/Invalid data URL/);
    expect(() => decodeImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toThrow(/Invalid data URL/);
    expect(() => decodeImageDataUrl('not a data url')).toThrow(/Invalid data URL/);
    expect(() => decodeImageDataUrl(null)).toThrow(/Invalid data URL/);
  });
});
