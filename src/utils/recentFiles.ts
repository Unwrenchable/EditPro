import type { EditorMode } from '../types';

export const RECENT_FILES_LIMIT = 10;

export interface RecentFileEntry {
  path: string;
  name: string;
  mode: EditorMode;
  openedAt: string;
  /** Browser sessions keep the project text so a recent entry can be reopened. */
  contents?: string;
}

const MODES: readonly EditorMode[] = ['photo', 'video', 'magic'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export function sanitizeRecentList(value: unknown): RecentFileEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: RecentFileEntry[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record || typeof record.path !== 'string' || !record.path || seen.has(record.path)) continue;
    if (!MODES.includes(record.mode as EditorMode)) continue;
    seen.add(record.path);
    const entry: RecentFileEntry = {
      path: record.path,
      name: typeof record.name === 'string' && record.name ? record.name : record.path,
      mode: record.mode as EditorMode,
      openedAt: typeof record.openedAt === 'string' ? record.openedAt : new Date(0).toISOString(),
    };
    if (typeof record.contents === 'string') entry.contents = record.contents;
    entries.push(entry);
    if (entries.length >= RECENT_FILES_LIMIT) break;
  }
  return entries;
}

/** Insert `entry` at the front, drop duplicates, and cap the list. */
export function addRecentFile(list: RecentFileEntry[], entry: RecentFileEntry): RecentFileEntry[] {
  return sanitizeRecentList([entry, ...list.filter((item) => item.path !== entry.path)]);
}

export function removeRecentFile(list: RecentFileEntry[], path: string): RecentFileEntry[] {
  return list.filter((item) => item.path !== path);
}
