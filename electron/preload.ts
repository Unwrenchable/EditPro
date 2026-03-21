/**
 * Electron preload script.
 * Exposes a safe, typed bridge (window.editpro) to the renderer via contextBridge.
 * nodeIntegration is OFF; contextIsolation is ON.
 */
import { contextBridge, ipcRenderer } from 'electron';

// ── Type-safe IPC bridge exposed to renderer ─────────────────────────────────
contextBridge.exposeInMainWorld('editpro', {
  /** Open native image file picker. Returns array of file paths or null. */
  openImage: (): Promise<string[] | null> => ipcRenderer.invoke('dialog:openImage'),

  /** Open native video file picker. Returns file path or null. */
  openVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:openVideo'),

  /** Open native save dialog. Returns destination path or null. */
  saveImage: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveImage', defaultName),

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

  /** Listen for menu events sent from the main process. */
  onMenu: (
    channel: 'menu:openImage' | 'menu:openVideo' | 'menu:export' | 'menu:resetAdjustments',
    listener: () => void
  ) => {
    ipcRenderer.on(channel, listener);
    // Return cleanup function
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
