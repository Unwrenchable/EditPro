/**
 * Pure security checks for the Electron main process.
 * Kept free of Electron imports so the rules can be unit tested.
 */
import path from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'bundle';
/** Origin Chromium assigns once `app` is registered as a standard scheme. */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const MAX_PATH_LENGTH = 4096;
const MAX_EXTERNAL_URL_LENGTH = 2048;
const MAX_WRITE_BYTES = 256 * 1024 * 1024;

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

export interface NavigationOptions {
  isDev: boolean;
  devPort: string;
}

export interface IpcFrame {
  origin: string;
  url: string;
  /** Top-level frames have no parent. Subframes are rejected. */
  parent: unknown;
}

function devPortOrDefault(devPort: string): string {
  return /^\d+$/.test(devPort) ? devPort : '5173';
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Absolute, lexical path identity for allowlist checks.
 * Does not follow symlinks: the grant is the path the user picked.
 */
export function canonicalizePath(filePath: unknown): string {
  if (typeof filePath !== 'string') {
    throw new Error('Path must be a string');
  }
  if (filePath.length === 0 || filePath.length > MAX_PATH_LENGTH) {
    throw new Error('Invalid path');
  }
  if (filePath.includes('\0') || hasControlCharacters(filePath)) {
    throw new Error('Invalid path');
  }
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Remembers paths the user confirmed in open/save dialogs or by picking a file.
 * Read grants stay until the window closes. Image writes consume a write grant.
 * Project saves and video export reuse the write grant for the path the user chose.
 * Ephemeral reads (export temp files) are not included in snapshots.
 */
export class FileAccessGrants {
  private readonly readPaths = new Set<string>();
  private readonly writePaths = new Set<string>();
  private readonly ephemeralReads = new Set<string>();

  grantRead(filePath: string, options?: { ephemeral?: boolean }): void {
    const canonical = canonicalizePath(filePath);
    this.readPaths.add(canonical);
    if (options?.ephemeral) this.ephemeralReads.add(canonical);
    else this.ephemeralReads.delete(canonical);
  }

  grantWrite(filePath: string): void {
    this.writePaths.add(canonicalizePath(filePath));
  }

  clear(): void {
    this.readPaths.clear();
    this.writePaths.clear();
    this.ephemeralReads.clear();
  }

  assertCanRead(filePath: unknown): string {
    const canonical = canonicalizePath(filePath);
    if (!this.readPaths.has(canonical)) {
      throw new Error('Refusing to read a path that was not chosen in an open dialog');
    }
    return canonical;
  }

  /** Write grant that stays in place so the same chosen path can be saved again. */
  assertCanWrite(filePath: unknown): string {
    const canonical = canonicalizePath(filePath);
    if (!this.writePaths.has(canonical)) {
      throw new Error('Refusing to write a path that was not chosen in a save dialog');
    }
    return canonical;
  }

  hasRead(filePath: unknown): boolean {
    try {
      return this.readPaths.has(canonicalizePath(filePath));
    } catch {
      return false;
    }
  }

  hasWrite(filePath: unknown): boolean {
    try {
      return this.writePaths.has(canonicalizePath(filePath));
    } catch {
      return false;
    }
  }

  /** Persisted allowlist. Temp export files are omitted. */
  snapshot(): { read: string[]; write: string[] } {
    return {
      read: [...this.readPaths].filter((entry) => !this.ephemeralReads.has(entry)),
      write: [...this.writePaths],
    };
  }

  /** Returns the canonical path and removes the grant so it cannot be reused. */
  consumeWrite(filePath: unknown): string {
    const canonical = canonicalizePath(filePath);
    if (!this.writePaths.delete(canonical)) {
      throw new Error('Refusing to write a path that was not chosen in a save dialog');
    }
    return canonical;
  }
}

/**
 * True when `candidate` is a file or directory strictly inside `root`.
 * Comparison uses the same lexical canonical path as the grant set.
 */
export function isPathInside(root: string, candidate: string): boolean {
  const rootCanonical = canonicalizePath(root);
  const candidateCanonical = canonicalizePath(candidate);
  return candidateCanonical.startsWith(`${rootCanonical}${path.sep}`);
}

/** Keep the save dialog from suggesting a path the renderer invented. */
export function sanitizeSaveFileName(name: unknown, fallback = 'editpro-export.png'): string {
  if (typeof name !== 'string') return fallback;
  const normalized = name.replaceAll('\\', '/');
  const base = path.basename(normalized);
  if (!base || base === '.' || base === '..' || base.length > 255) return fallback;
  if (hasControlCharacters(base) || base.includes('\0')) return fallback;
  return base;
}

/**
 * https and mailto only, parsed with the URL parser (not a prefix check).
 * Returns the normalized href, or null when the URL must not be opened.
 */
export function parseAllowedExternalUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  if (input.length === 0 || input.length > MAX_EXTERNAL_URL_LENGTH) return null;
  if (hasControlCharacters(input) || /\s/.test(input)) return null;
  if (input.includes('\\') || input.includes('"') || input.includes("'") || input.includes('`')) {
    return null;
  }
  if (/%00|%0a|%0d/i.test(input)) return null;

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;

  if (parsed.protocol === 'https:') {
    if (!parsed.hostname) return null;
    return parsed.href;
  }
  if (parsed.protocol === 'mailto:') {
    if (!parsed.pathname) return null;
    return parsed.href;
  }
  return null;
}

export function isDevToolsUrl(url: string): boolean {
  return url.startsWith('devtools://') || url.startsWith('chrome-devtools://');
}

export function isAllowedAppNavigation(url: string, options: NavigationOptions): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (options.isDev) {
    const port = devPortOrDefault(options.devPort);
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      parsed.port === port
    );
  }
  return parsed.protocol === `${APP_SCHEME}:` && parsed.hostname === APP_HOST;
}

/**
 * Navigation policy for every webContents.
 * App windows may stay on the dev server or the app:// origin.
 * DevTools may boot and stay on the devtools origin.
 */
export function isNavigationAllowed(
  currentUrl: string,
  targetUrl: string,
  options: NavigationOptions,
): boolean {
  if (isAllowedAppNavigation(targetUrl, options)) return true;
  if (isDevToolsUrl(targetUrl) && (currentUrl === '' || isDevToolsUrl(currentUrl))) return true;
  if (isDevToolsUrl(currentUrl) && targetUrl === 'about:blank') return true;
  return false;
}

export function isTrustedIpcOrigin(
  origin: string | null | undefined,
  options: NavigationOptions,
): boolean {
  if (!origin || origin === 'null') return false;
  if (options.isDev) {
    const port = devPortOrDefault(options.devPort);
    return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
  }
  return origin === APP_ORIGIN;
}

/** Privileged IPC is accepted only from the top-level app frame. */
export function isTrustedIpcFrame(
  frame: IpcFrame | null | undefined,
  options: NavigationOptions,
): boolean {
  if (!frame || frame.parent != null) return false;
  if (!isTrustedIpcOrigin(frame.origin, options)) return false;
  return isAllowedAppNavigation(frame.url, options);
}

/**
 * CSP for the renderer.
 * Production allows only this app's scripts and stylesheets.
 * Development additionally allows Vite's inline HMR preamble and injected style tags.
 * Neither policy allows eval or remote script.
 */
export function buildContentSecurityPolicy(
  options: NavigationOptions & { delivery?: 'header' | 'meta' },
): string {
  const port = devPortOrDefault(options.devPort);
  const scriptSrc = options.isDev ? "'self' 'unsafe-inline'" : "'self'";
  const styleSrc = options.isDev ? "'self' 'unsafe-inline'" : "'self'";
  // blob: and media: are same-app preview bytes (imported files and proxy tickets).
  // Remote hosts stay blocked.
  const connectSrc = options.isDev
    ? `'self' blob: media: ws://localhost:${port} http://localhost:${port} ws://127.0.0.1:${port} http://127.0.0.1:${port}`
    : 'blob: media:';

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "script-src-attr 'none'",
    `style-src ${styleSrc}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob: media:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
  ];
  // Meta tags ignore frame-ancestors and Chromium logs an error when it is present.
  if (options.delivery !== 'meta') {
    directives.push("frame-ancestors 'none'");
  }
  return directives.join('; ');
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

export function contentTypeForPath(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Map an app://bundle request onto a file inside the renderer build directory.
 * Returns null when the URL is not our scheme or escapes the directory.
 */
export function resolveAppStaticPath(distRoot: string, requestUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.hostname !== APP_HOST) return null;
  if (parsed.username || parsed.password) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;

  const segments = decoded.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes(':'))) {
    return null;
  }
  const relative = segments.length === 0 ? 'index.html' : segments.join('/');
  const root = path.resolve(distRoot);
  const candidate = path.resolve(root, relative);
  const relativeToRoot = path.relative(root, candidate);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return null;
  return candidate;
}

export function decodeImageDataUrl(dataUrl: unknown): Buffer {
  if (typeof dataUrl !== 'string' || dataUrl.length === 0 || dataUrl.length > MAX_WRITE_BYTES) {
    throw new Error('Invalid data URL');
  }
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) throw new Error('Invalid data URL');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_WRITE_BYTES) {
    throw new Error('Invalid data URL');
  }
  return bytes;
}

const READ_MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
};

export function mimeTypeForRead(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return READ_MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function isSafeRelativeMediaPath(relativePath: string): boolean {
  if (relativePath.includes('\0') || hasControlCharacters(relativePath)) return false;
  if (path.isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath)) return false;
  const parts = relativePath.split(/[/\\]/);
  return parts.length > 0 && parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

/**
 * Media paths named by an .editpro project that stay inside the project directory.
 * Absolute paths outside that directory are ignored so a project file cannot
 * grant reads of arbitrary locations. Those files are granted when the user
 * imports or relinks them.
 */
export function mediaPathsInsideDirectory(projectFilePath: string, contents: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const media = (parsed as { media?: unknown }).media;
  if (!Array.isArray(media)) return [];

  let projectDir: string;
  try {
    projectDir = path.dirname(canonicalizePath(projectFilePath));
  } catch {
    return [];
  }

  const granted: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string) => {
    try {
      if (!isPathInside(projectDir, candidate)) return;
      const canonical = canonicalizePath(candidate);
      if (seen.has(canonical)) return;
      seen.add(canonical);
      granted.push(canonical);
    } catch {
      // Skip malformed paths.
    }
  };

  for (const entry of media) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { path?: unknown; relativePath?: unknown };
    if (typeof record.path === 'string' && record.path) add(record.path);
    if (typeof record.relativePath === 'string' && isSafeRelativeMediaPath(record.relativePath)) {
      add(path.resolve(projectDir, record.relativePath));
    }
  }
  return granted;
}
