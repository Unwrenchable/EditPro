/**
 * `media://` streams proxy files the main process just wrote.
 * The renderer receives an unguessable ticket, never a filesystem path.
 * Tickets resolve only to regular files inside the proxy cache.
 */
import { randomBytes } from 'node:crypto';
import { isTrustedIpcOrigin, type NavigationOptions } from '../security.js';

export const MEDIA_SCHEME = 'media';
export const MEDIA_HOST = 'clip';

const TICKET_RE = /^[a-f0-9]{32}$/;

export function createMediaTicketId(): string {
  return randomBytes(16).toString('hex');
}

export function mediaTicketUrl(id: string): string {
  if (!TICKET_RE.test(id)) throw new Error('Invalid media ticket');
  return `${MEDIA_SCHEME}://${MEDIA_HOST}/${id}`;
}

/** Returns the ticket id, or null when the URL is not one of ours. */
export function mediaTicketIdFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:`) return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.hostname !== MEDIA_HOST) return null;
  if (parsed.search || parsed.hash) return null;
  const id = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
  if (id.includes('/') || !TICKET_RE.test(id)) return null;
  return id;
}

export function trustedMediaOrigin(origin: string | null, options: NavigationOptions): string | null {
  if (!origin) return null;
  return isTrustedIpcOrigin(origin, options) ? origin : null;
}

/**
 * `<video>` requests for media:// often omit Origin. A missing Origin is
 * allowed because the ticket is unguessable. A present Origin must be the app.
 * Returns the Access-Control-Allow-Origin value, or null to refuse the request.
 */
export function resolveMediaAllowOrigin(origin: string | null, options: NavigationOptions): string | null {
  if (origin === null || origin === '' || origin === 'null') return '*';
  return trustedMediaOrigin(origin, options);
}

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse a single `Range: bytes=` header.
 * Returns null when the request has no range (send the whole file).
 */
export function parseByteRange(header: string | null, size: number): ByteRange | 'invalid' | null {
  if (header === null || header.trim() === '') return null;
  if (!Number.isFinite(size) || size < 0) return 'invalid';
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return 'invalid';
  if (size === 0) return 'invalid';

  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return 'invalid';
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }

  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return 'invalid';
  if (start < 0 || start >= size || end < start) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

export interface MediaResponsePlan {
  status: number;
  headers: Record<string, string>;
  start: number;
  end: number;
  sendBody: boolean;
}

export function planMediaResponse(options: {
  method: string;
  allowOrigin: string | null;
  ticketFound: boolean;
  pathAllowed: boolean;
  size: number;
  rangeHeader: string | null;
}): MediaResponsePlan {
  const method = options.method.toUpperCase();
  if (!options.allowOrigin) {
    return emptyPlan(403);
  }
  const headers = corsHeaders(options.allowOrigin);
  if (method === 'OPTIONS') {
    return { status: 204, headers, start: 0, end: 0, sendBody: false };
  }
  if (method !== 'GET' && method !== 'HEAD') {
    return { status: 405, headers, start: 0, end: 0, sendBody: false };
  }
  if (!options.ticketFound) {
    return { status: 404, headers, start: 0, end: 0, sendBody: false };
  }
  if (!options.pathAllowed || options.size <= 0) {
    return { status: 403, headers, start: 0, end: 0, sendBody: false };
  }

  const range = parseByteRange(options.rangeHeader, options.size);
  if (range === 'invalid') {
    return {
      status: 416,
      headers: {
        ...headers,
        'Content-Range': `bytes */${options.size}`,
        'Accept-Ranges': 'bytes',
      },
      start: 0,
      end: 0,
      sendBody: false,
    };
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? options.size - 1;
  const status = range ? 206 : 200;
  const length = end - start + 1;
  return {
    status,
    start,
    end,
    sendBody: method === 'GET',
    headers: {
      ...headers,
      'Content-Type': 'video/mp4',
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${options.size}` } : {}),
    },
  };
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type',
    Vary: 'Origin',
  };
}

function emptyPlan(status: number): MediaResponsePlan {
  return { status, headers: { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' }, start: 0, end: 0, sendBody: false };
}
