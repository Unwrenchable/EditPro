/**
 * Electron preload script.
 * Exposes a safe, typed bridge (window.editpro) to the renderer via contextBridge.
 * nodeIntegration is OFF; contextIsolation is ON.
 */
import { contextBridge, ipcRenderer } from 'electron';

type MenuChannel =
  | 'menu:openProject'
  | 'menu:openImage'
  | 'menu:openVideo'
  | 'menu:save'
  | 'menu:saveAs'
  | 'menu:export'
  | 'menu:undo'
  | 'menu:redo'
  | 'menu:resetAdjustments';

// ── Type-safe IPC bridge exposed to renderer ─────────────────────────────────
contextBridge.exposeInMainWorld('editpro', {
  /** Open native image file picker. Returns array of file paths or null. */
  openImage: (): Promise<string[] | null> => ipcRenderer.invoke('dialog:openImage'),

  /** Open native video file picker. Returns file path or null. */
  openVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:openVideo'),

  /** Open an EditPro project. Returns the chosen path or null. */
  openProject: (): Promise<string | null> => ipcRenderer.invoke('dialog:openProject'),

  /** Pick a destination for an EditPro project. Returns the path or null. */
  saveProject: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveProject', defaultName),

  /** Open native save dialog. Returns destination path or null. */
  saveImage: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveImage', defaultName),

  /** Read a file from disk and return as a base64 data URL. */
  readFileAsDataUrl: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('fs:readFileAsDataUrl', filePath),

  /** Write a base64 data URL to a file path. */
  writeDataUrlToFile: (filePath: string, dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:writeDataUrlToFile', filePath, dataUrl),

  /** Read a UTF-8 text file, used for .editpro projects. */
  readTextFile: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:readTextFile', filePath),

  /** Write a UTF-8 .editpro project. */
  writeTextFile: (filePath: string, contents: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:writeTextFile', filePath, contents),

  readRecent: (): Promise<string> => ipcRenderer.invoke('recent:read'),

  writeRecent: (contents: string): Promise<boolean> => ipcRenderer.invoke('recent:write', contents),

  getRecovery: () => ipcRenderer.invoke('session:getRecovery'),

  autosave: (contents: string, projectPath: string | null): Promise<boolean> =>
    ipcRenderer.invoke('session:autosave', contents, projectPath),

  flushAutosave: (contents: string, projectPath: string | null): boolean =>
    ipcRenderer.sendSync('session:autosaveSync', contents, projectPath) as boolean,

  noteSaved: (projectPath: string): Promise<boolean> => ipcRenderer.invoke('session:noteSaved', projectPath),

  discardRecovery: (): Promise<boolean> => ipcRenderer.invoke('session:discardRecovery'),

  markCleanShutdown: (): Promise<boolean> => ipcRenderer.invoke('session:markClean'),

  /** Returns the current app version string. */
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  /** Returns the OS platform string ('darwin' | 'win32' | 'linux'). */
  getPlatform: (): Promise<string> => ipcRenderer.invoke('app:getPlatform'),

  /** Listen for menu events sent from the main process. */
  onMenu: (channel: MenuChannel, listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
