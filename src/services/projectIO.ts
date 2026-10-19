import type { EditProBridge } from '../types/electron';
import { ensureProjectExtension, fileNameFromPath } from '../utils/projectFile';
import { addRecentFile, sanitizeRecentList, type RecentFileEntry } from '../utils/recentFiles';
import { fileFromDataUrl, fileMediaPath } from '../utils/mediaFiles';
import {
  beginSession,
  discardSessionAutosave,
  markSessionClean,
  normalizeSessionMeta,
  noteSessionSaved,
  recordAutosave,
  type RecoveryOffer,
  type SessionMeta,
  type SessionPersistence,
} from '../utils/sessionStore';

export interface PickedMedia {
  file: File;
  path: string | null;
}

export interface OpenedProject {
  path: string;
  contents: string;
}

export interface ProjectIO {
  boot(): Promise<RecoveryOffer | null>;
  openProject(): Promise<OpenedProject | null>;
  pickSavePath(suggestedName: string): Promise<string | null>;
  writeProject(path: string, contents: string): Promise<void>;
  readProject(path: string): Promise<string>;
  readMediaDataUrl(path: string): Promise<string>;
  listRecent(): Promise<RecentFileEntry[]>;
  rememberRecent(entry: RecentFileEntry): Promise<RecentFileEntry[]>;
  pickMedia(kind: 'image' | 'video'): Promise<PickedMedia | null>;
  autosave(contents: string, projectPath: string | null): Promise<void>;
  flushAutosave(contents: string, projectPath: string | null): void;
  noteSaved(projectPath: string): Promise<void>;
  discardRecovery(): Promise<void>;
  markCleanShutdown(): Promise<void>;
}

const META_KEY = 'editpro.session.meta';
const AUTOSAVE_KEY = 'editpro.session.autosave';
const RECENT_KEY = 'editpro.recent';

let pageBootToken = `boot-${Math.random().toString(36).slice(2)}`;

/** Start a fresh boot identity. Tests use this to simulate the next launch. */
export function resetPageBootToken(): void {
  pageBootToken = `boot-${Math.random().toString(36).slice(2)}`;
}

function storageSession(storage: Storage): SessionPersistence {
  return {
    readMeta(): SessionMeta | null {
      const raw = storage.getItem(META_KEY);
      if (!raw) return null;
      try {
        return normalizeSessionMeta(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    writeMeta(meta: SessionMeta) {
      storage.setItem(META_KEY, JSON.stringify(meta));
    },
    readAutosave() {
      return storage.getItem(AUTOSAVE_KEY);
    },
    writeAutosave(contents: string) {
      storage.setItem(AUTOSAVE_KEY, contents);
    },
    clearAutosave() {
      storage.removeItem(AUTOSAVE_KEY);
    },
  };
}

function readStoredRecent(storage: Storage): RecentFileEntry[] {
  const raw = storage.getItem(RECENT_KEY);
  if (!raw) return [];
  try {
    return sanitizeRecentList(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeStoredRecent(storage: Storage, entries: RecentFileEntry[]): void {
  storage.setItem(RECENT_KEY, JSON.stringify(entries));
}

function downloadTextFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function pickTextFile(accept: string): Promise<{ name: string; contents: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then((contents) => resolve({ name: file.name, contents }))
        .catch(() => resolve(null));
    };
    input.click();
  });
}

function pickBinaryFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export function createBrowserProjectIO(storage: Storage): ProjectIO {
  const session = storageSession(storage);
  const files = new Map<string, string>();
  let bootInflight: Promise<RecoveryOffer | null> | null = null;

  return {
    boot() {
      bootInflight ??= Promise.resolve(beginSession(session, pageBootToken));
      return bootInflight;
    },
    async openProject() {
      const picked = await pickTextFile('.editpro,application/json');
      if (!picked) return null;
      const path = picked.name;
      files.set(path, picked.contents);
      return { path, contents: picked.contents };
    },
    async pickSavePath(suggestedName: string) {
      const suggested = ensureProjectExtension(suggestedName);
      const entered = window.prompt('Save EditPro project as', suggested);
      if (!entered) return null;
      const name = ensureProjectExtension(entered.trim());
      return name || null;
    },
    async writeProject(path: string, contents: string) {
      const name = ensureProjectExtension(fileNameFromPath(path));
      files.set(path, contents);
      files.set(name, contents);
      downloadTextFile(name, contents);
    },
    async readProject(path: string) {
      const cached = files.get(path);
      if (cached !== undefined) return cached;
      const recent = readStoredRecent(storage).find((entry) => entry.path === path);
      if (recent?.contents) return recent.contents;
      throw new Error('That recent project is no longer available in this browser. Open it from disk.');
    },
    readMediaDataUrl(path: string) {
      return Promise.reject(new Error(`Media at ${path} is not readable in the browser.`));
    },
    async listRecent() {
      return readStoredRecent(storage);
    },
    async rememberRecent(entry: RecentFileEntry) {
      const next = addRecentFile(readStoredRecent(storage), entry);
      try {
        writeStoredRecent(storage, next);
      } catch {
        const slim = next.map((item) => ({ ...item, contents: undefined }));
        writeStoredRecent(storage, slim);
        return slim;
      }
      return next;
    },
    async pickMedia(kind: 'image' | 'video') {
      const accept =
        kind === 'image'
          ? 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff'
          : 'video/mp4,video/webm,video/ogg,video/quicktime,video/x-msvideo';
      const file = await pickBinaryFile(accept);
      if (!file) return null;
      return { file, path: fileMediaPath(file) };
    },
    async autosave(contents: string, projectPath: string | null) {
      recordAutosave(session, contents, projectPath);
    },
    flushAutosave(contents: string, projectPath: string | null) {
      recordAutosave(session, contents, projectPath);
    },
    async noteSaved(projectPath: string) {
      noteSessionSaved(session, projectPath);
    },
    async discardRecovery() {
      discardSessionAutosave(session);
    },
    async markCleanShutdown() {
      markSessionClean(session);
    },
  };
}

function bridgeError(error: unknown): never {
  throw error instanceof Error ? error : new Error('File operation failed');
}

export function createElectronProjectIO(bridge: EditProBridge): ProjectIO {
  return {
    boot() {
      return bridge.getRecovery();
    },
    async openProject() {
      const path = await bridge.openProject();
      if (!path) return null;
      const contents = await bridge.readTextFile(path);
      return { path, contents };
    },
    pickSavePath(suggestedName: string) {
      return bridge.saveProject(ensureProjectExtension(suggestedName));
    },
    async writeProject(path: string, contents: string) {
      await bridge.writeTextFile(path, contents);
    },
    readProject(path: string) {
      return bridge.readTextFile(path);
    },
    readMediaDataUrl(path: string) {
      return bridge.readFileAsDataUrl(path);
    },
    async listRecent() {
      try {
        return sanitizeRecentList(JSON.parse(await bridge.readRecent()));
      } catch {
        return [];
      }
    },
    async rememberRecent(entry: RecentFileEntry) {
      const current = await this.listRecent();
      const stored: RecentFileEntry = {
        path: entry.path,
        name: entry.name,
        mode: entry.mode,
        openedAt: entry.openedAt,
      };
      const next = addRecentFile(current, stored);
      await bridge.writeRecent(JSON.stringify(next));
      return next;
    },
    async pickMedia(kind) {
      try {
        if (kind === 'image') {
          const paths = await bridge.openImage();
          const path = paths?.[0];
          if (!path) return null;
          const dataUrl = await bridge.readFileAsDataUrl(path);
          const file = await fileFromDataUrl(dataUrl, fileNameFromPath(path));
          return { file, path };
        }
        const path = await bridge.openVideo();
        if (!path) return null;
        const dataUrl = await bridge.readFileAsDataUrl(path);
        const file = await fileFromDataUrl(dataUrl, fileNameFromPath(path));
        return { file, path };
      } catch (error) {
        bridgeError(error);
      }
    },
    async autosave(contents, projectPath) {
      await bridge.autosave(contents, projectPath);
    },
    flushAutosave(contents, projectPath) {
      bridge.flushAutosave(contents, projectPath);
    },
    async noteSaved(projectPath) {
      await bridge.noteSaved(projectPath);
    },
    async discardRecovery() {
      await bridge.discardRecovery();
    },
    async markCleanShutdown() {
      await bridge.markCleanShutdown();
    },
  };
}

export function createProjectIO(): ProjectIO {
  if (typeof window !== 'undefined' && window.editpro?.openProject) {
    return createElectronProjectIO(window.editpro);
  }
  return createBrowserProjectIO(window.localStorage);
}
