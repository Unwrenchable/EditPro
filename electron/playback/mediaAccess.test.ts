import { describe, expect, it } from 'vitest';
import {
  createMediaTicketId,
  mediaTicketIdFromUrl,
  mediaTicketUrl,
  parseByteRange,
  planMediaResponse,
  trustedMediaOrigin,
} from './mediaAccess.js';

const dev = { isDev: true, devPort: '5173' };
const prod = { isDev: false, devPort: '5173' };

describe('media tickets', () => {
  it('issues an unguessable url that does not contain a file path', () => {
    const id = createMediaTicketId();
    const url = mediaTicketUrl(id);
    expect(url).toBe(`media://clip/${id}`);
    expect(url).not.toContain('films');
    expect(url).not.toContain('.mp4');
    expect(mediaTicketIdFromUrl(url)).toBe(id);
    expect(mediaTicketIdFromUrl('media://clip/../../etc/passwd')).toBeNull();
    expect(mediaTicketIdFromUrl('file:///etc/passwd')).toBeNull();
    expect(mediaTicketIdFromUrl('media://evil/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBeNull();
    expect(mediaTicketIdFromUrl(`media://user:pass@clip/${id}`)).toBeNull();
    expect(mediaTicketIdFromUrl(`${url}?x=1`)).toBeNull();
  });

  it('trusts only the app origin', () => {
    expect(trustedMediaOrigin('http://localhost:5173', dev)).toBe('http://localhost:5173');
    expect(trustedMediaOrigin('https://evil.example', dev)).toBeNull();
    expect(trustedMediaOrigin('app://bundle', prod)).toBe('app://bundle');
    expect(trustedMediaOrigin('http://localhost:5173', prod)).toBeNull();
    expect(trustedMediaOrigin(null, prod)).toBeNull();
  });
});

describe('media byte ranges', () => {
  it('parses full-file and partial ranges', () => {
    expect(parseByteRange(null, 1000)).toBeNull();
    expect(parseByteRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(parseByteRange('bytes=-50', 1000)).toEqual({ start: 950, end: 999 });
    expect(parseByteRange('bytes=1000-1001', 1000)).toBe('invalid');
    expect(parseByteRange('bytes=20-10', 1000)).toBe('invalid');
  });

  it('refuses untrusted origins and ungranted tickets', () => {
    const denied = planMediaResponse({
      method: 'GET',
      allowOrigin: null,
      ticketFound: true,
      pathAllowed: true,
      size: 100,
      rangeHeader: null,
    });
    expect(denied.status).toBe(403);
    expect(denied.headers['Access-Control-Allow-Origin']).toBeUndefined();

    const missing = planMediaResponse({
      method: 'GET',
      allowOrigin: 'app://bundle',
      ticketFound: false,
      pathAllowed: false,
      size: 0,
      rangeHeader: null,
    });
    expect(missing.status).toBe(404);

    const escaped = planMediaResponse({
      method: 'GET',
      allowOrigin: 'app://bundle',
      ticketFound: true,
      pathAllowed: false,
      size: 10,
      rangeHeader: null,
    });
    expect(escaped.status).toBe(403);
  });

  it('answers range requests for a real proxy file', () => {
    const plan = planMediaResponse({
      method: 'GET',
      allowOrigin: 'app://bundle',
      ticketFound: true,
      pathAllowed: true,
      size: 5000,
      rangeHeader: 'bytes=0-99',
    });
    expect(plan.status).toBe(206);
    expect(plan.sendBody).toBe(true);
    expect(plan.start).toBe(0);
    expect(plan.end).toBe(99);
    expect(plan.headers['Content-Range']).toBe('bytes 0-99/5000');
    expect(plan.headers['Content-Type']).toBe('video/mp4');
    expect(plan.headers['Content-Security-Policy']).toBe("default-src 'none'");
    expect(plan.headers['Access-Control-Allow-Origin']).toBe('app://bundle');

    const preflight = planMediaResponse({
      method: 'OPTIONS',
      allowOrigin: 'http://localhost:5173',
      ticketFound: false,
      pathAllowed: false,
      size: 0,
      rangeHeader: null,
    });
    expect(preflight.status).toBe(204);
    expect(preflight.sendBody).toBe(false);

    const bad = planMediaResponse({
      method: 'GET',
      allowOrigin: 'app://bundle',
      ticketFound: true,
      pathAllowed: true,
      size: 5000,
      rangeHeader: 'bytes=9000-',
    });
    expect(bad.status).toBe(416);
  });
});
