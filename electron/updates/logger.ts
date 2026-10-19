import fs from 'node:fs';
import path from 'node:path';

export const MAX_LOG_BYTES = 512 * 1024;
export const PRESERVE_LOG_BYTES = 256 * 1024;

export function formatLogEntry(at: Date, level: 'error' | 'info', message: string): string {
  const flat = message.replace(/\0/g, '').replace(/\r\n/g, '\n').trim();
  return `[${at.toISOString()}] ${level.toUpperCase()} ${flat}\n`;
}

export function nextLogContents(
  existing: string,
  entry: string,
  maxBytes = MAX_LOG_BYTES,
  preserveBytes = PRESERVE_LOG_BYTES,
): string {
  const combined = existing.length === 0 ? entry : `${existing.endsWith('\n') ? existing : `${existing}\n`}${entry}`;
  const body = combined.endsWith('\n') ? combined : `${combined}\n`;
  if (Buffer.byteLength(body, 'utf8') <= maxBytes) return body;
  const slice = body.slice(-preserveBytes);
  const newline = slice.indexOf('\n');
  const trimmed = newline >= 0 ? slice.slice(newline + 1) : slice;
  return `… log truncated …\n${trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`}`;
}

/** Turn a renderer error report into one log entry, or null when it is empty or the wrong shape. */
export function clientErrorMessage(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  if (typeof record.message !== 'string' || record.message.trim().length === 0) return null;
  const message = record.message.replace(/\0/g, '').trim().slice(0, 2_000);
  const source = typeof record.source === 'string' ? record.source.replace(/\0/g, '').trim().slice(0, 500) : '';
  const stack = typeof record.stack === 'string' ? record.stack.replace(/\0/g, '').trim().slice(0, 6_000) : '';
  return [`renderer: ${message}`, source ? `source: ${source}` : '', stack].filter((line) => line.length > 0).join('\n');
}

export class CrashLog {
  private enabled: boolean;
  private stamps: number[] = [];

  constructor(
    readonly filePath: string,
    enabled: boolean,
    private readonly limits: { maxBytes?: number; preserveBytes?: number; maxPerMinute?: number } = {},
  ) {
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  exists(): boolean {
    try {
      return fs.existsSync(this.filePath);
    } catch {
      return false;
    }
  }

  write(level: 'error' | 'info', message: string): void {
    if (!this.enabled || !this.allow()) return;
    const entry = formatLogEntry(new Date(), level, message);
    try {
      const existing = fs.existsSync(this.filePath) ? fs.readFileSync(this.filePath, 'utf8') : '';
      const next = nextLogContents(existing, entry, this.limits.maxBytes, this.limits.preserveBytes);
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, next, 'utf8');
      fs.renameSync(tmp, this.filePath);
    } catch (error) {
      console.error('EditPro could not write the crash log', error);
    }
  }

  private allow(): boolean {
    const now = Date.now();
    const cap = this.limits.maxPerMinute ?? 40;
    this.stamps = this.stamps.filter((stamp) => now - stamp < 60_000);
    if (this.stamps.length >= cap) return false;
    this.stamps.push(now);
    return true;
  }
}
