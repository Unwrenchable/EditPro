/**
 * Electron preload script.
 * Exposes a safe, typed bridge (window.editpro) to the renderer via contextBridge.
 * nodeIntegration is OFF; contextIsolation is ON; sandbox is ON.
 * Compiled to CommonJS (see tsconfig.preload.json): sandboxed preloads cannot use ESM import.
 */
import { contextBridge, ipcRenderer } from 'electron';

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
