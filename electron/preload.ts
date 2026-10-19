/**
 * Electron preload script.
 * Exposes a safe, typed bridge (window.editpro) to the renderer via contextBridge.
 * nodeIntegration is OFF; contextIsolation is ON; sandbox is ON.
 * Compiled to CommonJS (see tsconfig.preload.json): sandboxed preloads cannot use ESM import.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';

export interface VideoExportEvent {
  jobId: string;
  type: 'progress' | 'done' | 'cancelled' | 'error';
  percent?: number;
  timeSec?: number;
  fps?: number | null;
  done?: boolean;
  outputPath?: string;
  message?: string;
}

const MENU_CHANNELS = ['menu:openImage', 'menu:openVideo', 'menu:export', 'menu:resetAdjustments'] as const;
type MenuChannel = (typeof MENU_CHANNELS)[number];

function isMenuChannel(channel: string): channel is MenuChannel {
  return (MENU_CHANNELS as readonly string[]).includes(channel);
}

// ── Type-safe IPC bridge exposed to renderer ─────────────────────────────────
contextBridge.exposeInMainWorld('editpro', {
  /** Open native image file picker. Returns array of file paths or null. */
  openImage: (): Promise<string[] | null> => ipcRenderer.invoke('dialog:openImage'),

  /** Open native video file picker. Returns file path or null. */
  openVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:openVideo'),

  /** Open native save dialog. Returns destination path or null. */
  saveImage: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveImage', defaultName),

  /** Open a save dialog for an encoded video. Returns a destination path or null. */
  saveVideo: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveVideo', defaultName),

  /**
   * Absolute path for a File the user picked or dropped in Electron.
   * Empty string when the file has no disk path (browser, or an in-memory blob).
   */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file) ?? '';
    } catch {
      return '';
    }
  },

  /** Write a video that has no disk path into a temp file ffmpeg can read. */
  materializeVideoSource: (fileName: string, bytes: ArrayBuffer): Promise<string> =>
    ipcRenderer.invoke('export:materializeSource', fileName, bytes),

  /** Encode a video edit. Resolves when ffmpeg exits. Progress is delivered via onExportEvent. */
  startVideoExport: (request: unknown): Promise<{ status: 'done' | 'cancelled' | 'error'; outputPath: string; message?: string }> =>
    ipcRenderer.invoke('export:start', request),

  /** Stop an in-progress export. */
  cancelVideoExport: (jobId: string): Promise<boolean> => ipcRenderer.invoke('export:cancel', jobId),

  /** Subscribe to progress, completion, cancel, and error events for an export. */
  onExportEvent: (listener: (event: VideoExportEvent) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: VideoExportEvent) => listener(payload);
    ipcRenderer.on('export:event', wrapped);
    return () => ipcRenderer.removeListener('export:event', wrapped);
  },

  /** Reveal a file in the OS file manager. */
  showItemInFolder: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('shell:showItemInFolder', filePath),

  /** Read a file from disk and return as a base64 data URL. */
  readFileAsDataUrl: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('fs:readFileAsDataUrl', filePath),

  /** Write a base64 data URL to a file path. */
  writeDataUrlToFile: (filePath: string, dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:writeDataUrlToFile', filePath, dataUrl),

  /** Returns the current app version string. */
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  /** Returns the OS platform string ('darwin' | 'win32' | 'linux'). */
  getPlatform: (): Promise<string> => ipcRenderer.invoke('app:getPlatform'),

  /**
   * Listen for menu events sent from the main process.
   * The IPC event object is not forwarded — it exposes ipcRenderer.
   */
  onMenu: (channel: MenuChannel, listener: () => void) => {
    if (typeof listener !== 'function' || !isMenuChannel(channel)) {
      throw new Error('Invalid menu subscription');
    }
    const wrapped = () => {
      listener();
    };
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
