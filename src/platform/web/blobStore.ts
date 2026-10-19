const files = new Map<string, Blob>();
const names = new Map<string, string>();
const outputs = new Map<string, Blob>();

interface WritableStreamLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

export interface SaveHandle {
  createWritable(): Promise<WritableStreamLike>;
}

const handles = new Map<string, SaveHandle>();

export function resetBrowserStorage(): void {
  files.clear();
  names.clear();
  outputs.clear();
  handles.clear();
}

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

export function rememberFile(file: File): string {
  const safe = encodeURIComponent(file.name || 'file');
  const id = `browser:${safe}:${uid()}`;
  files.set(id, file);
  names.set(id, file.name || 'file');
  return id;
}

export function rememberBytes(fileName: string, bytes: ArrayBuffer): string {
  const safe = encodeURIComponent(fileName || 'media');
  const id = `memory:${safe}:${uid()}`;
  files.set(id, new Blob([bytes]));
  names.set(id, fileName || 'media');
  return id;
}

export function rememberHandle(handle: SaveHandle): string {
  const id = `handle:${uid()}`;
  handles.set(id, handle);
  return id;
}

export function getBlob(id: string): Blob | null {
  return files.get(id) ?? outputs.get(id) ?? null;
}

export function rememberOutput(path: string, blob: Blob): void {
  outputs.set(path, blob);
}

export function takeHandle(path: string): SaveHandle | null {
  if (!path.startsWith('handle:')) return null;
  return handles.get(path) ?? null;
}

export function displayName(id: string): string {
  const known = names.get(id);
  if (known) return known;
  if (id.startsWith('download:')) return id.slice('download:'.length) || 'editpro';
  const parts = id.split(':');
  if (parts.length >= 2 && parts[1]) {
    try {
      return decodeURIComponent(parts[1]);
    } catch {
      return parts[1];
    }
  }
  const base = id.split(/[/\\]/).pop();
  return base && base.length > 0 ? base : 'editpro';
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(blob);
  });
}

const TEXT_PREFIX = 'editpro.vfs:';

export function readVirtualText(filePath: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(TEXT_PREFIX + filePath);
}

export function writeVirtualText(filePath: string, contents: string): void {
  localStorage.setItem(TEXT_PREFIX + filePath, contents);
}
