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

export interface ProxyPlaybackEvent {
  jobId: string;
  sourcePath: string;
  scale: 'full' | 'half' | 'quarter';
  type: 'progress' | 'done' | 'cancelled' | 'error';
  percent?: number;
  mediaUrl?: string;
  width?: number;
  height?: number;
  fps?: number;
  durationSec?: number;
  message?: string;
}

export interface ProxyStartResult {
  jobId: string;
  status: 'ready' | 'started' | 'cancelled' | 'error';
  mediaUrl: string | null;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  message?: string;
}

const MENU_CHANNELS = [
  'menu:openProject',
  'menu:openImage',
  'menu:openVideo',
  'menu:save',
  'menu:saveAs',
  'menu:export',
  'menu:undo',
  'menu:redo',
  'menu:resetAdjustments',
  'menu:settings',
  'menu:about',
] as const;
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

  /** Open an EditPro project. Returns the chosen path or null. */
  openProject: (): Promise<string | null> => ipcRenderer.invoke('dialog:openProject'),

  /** Pick a destination for an EditPro project. Returns the path or null. */
  saveProject: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveProject', defaultName),

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
      const filePath = webUtils.getPathForFile(file) ?? '';
      if (filePath) {
        try {
          ipcRenderer.sendSync('fs:grantPickedFile', filePath);
        } catch {
          // The export and project readers refuse the path if the grant did not land.
        }
      }
      return filePath;
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

  /** Encoder names from `ffmpeg -encoders`, including NVENC, QSV, AMF, and VideoToolbox when present. */
  listVideoEncoders: (): Promise<string[]> => ipcRenderer.invoke('export:encoders'),

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

  /** GPU video-decode status after hardware-decode switches are applied. */
  getDecodeInfo: (): Promise<{ videoDecode: string; hardware: boolean; label: string; platform: string }> =>
    ipcRenderer.invoke('playback:decodeInfo'),

  /**
   * Build or reuse a low-resolution proxy for a granted source.
   * Progress and completion arrive on onProxyEvent. Export keeps using the original.
   */
  startProxy: (request: { sourcePath: string; scale: 'full' | 'half' | 'quarter' }): Promise<ProxyStartResult> =>
    ipcRenderer.invoke('playback:startProxy', request),

  cancelProxy: (jobId: string): Promise<boolean> => ipcRenderer.invoke('playback:cancelProxy', jobId),

  onProxyEvent: (listener: (event: ProxyPlaybackEvent) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: ProxyPlaybackEvent) => listener(payload);
    ipcRenderer.on('playback:event', wrapped);
    return () => ipcRenderer.removeListener('playback:event', wrapped);
  },

  classifyProxy: (sourcePath: string) => ipcRenderer.invoke('playback:classifyProxy', sourcePath),

  getProxyCache: () => ipcRenderer.invoke('playback:cacheStatus'),

  setProxyCachePolicy: (patch: { maxBytes?: number; auto?: boolean }) =>
    ipcRenderer.invoke('playback:setCachePolicy', patch),

  cleanupProxyCache: () => ipcRenderer.invoke('playback:cleanupCache'),

  relinkProxyCache: (paths: string[]) => ipcRenderer.invoke('playback:relinkCache', paths),

  /** Returns the current app version string. */
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  /** Returns the OS platform string ('darwin' | 'win32' | 'linux'). */
  getPlatform: (): Promise<string> => ipcRenderer.invoke('app:getPlatform'),

  /** Open an https or mailto URL in the system handler. The main process rejects anything else. */
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:openExternal', url),

  getPreferences: () => ipcRenderer.invoke('prefs:get'),

  setPreferences: (patch: unknown) => ipcRenderer.invoke('prefs:set', patch),

  getUpdateState: () => ipcRenderer.invoke('updates:getState'),

  onUpdateState: (listener: (dialog: unknown) => void) => {
    if (typeof listener !== 'function') throw new Error('Invalid update subscription');
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on('updates:state', wrapped);
    return () => ipcRenderer.removeListener('updates:state', wrapped);
  },

  checkForUpdates: () => ipcRenderer.invoke('updates:check'),

  downloadUpdate: () => ipcRenderer.invoke('updates:download'),

  installUpdate: () => ipcRenderer.invoke('updates:install'),

  skipUpdate: (version: string) => ipcRenderer.invoke('updates:skip', version),

  remindUpdateLater: () => ipcRenderer.invoke('updates:remind'),

  dismissUpdate: () => ipcRenderer.invoke('updates:dismiss'),

  recordClientError: (report: unknown) => ipcRenderer.invoke('logs:record', report),

  aiStatus: () => ipcRenderer.invoke('ai:status'),

  aiDownload: (request: { kind: 'model' | 'cli'; modelId?: string }) =>
    ipcRenderer.invoke('ai:download', request),

  aiCancel: (jobId: string) => ipcRenderer.invoke('ai:cancel', jobId),

  aiTranscribe: (request: { sourcePath: string; modelId: string; language?: string }) =>
    ipcRenderer.invoke('ai:transcribe', request),

  aiSaveCaptions: (request: { cues: unknown; format: 'srt' | 'vtt' }) =>
    ipcRenderer.invoke('ai:saveCaptions', request),

  aiBurnCaptions: (request: { sourcePath: string; cues: unknown }) =>
    ipcRenderer.invoke('ai:burnCaptions', request),

  aiRenderCut: (request: { sourcePath: string; ranges: { start: number; end: number }[] }) =>
    ipcRenderer.invoke('ai:renderCut', request),

  onAiEvent: (listener: (event: {
    jobId: string;
    type: 'progress' | 'done' | 'cancelled' | 'error';
    percent?: number;
    message?: string;
  }) => void) => {
    if (typeof listener !== 'function') throw new Error('Invalid AI subscription');
    const wrapped = (_event: unknown, payload: {
      jobId: string;
      type: 'progress' | 'done' | 'cancelled' | 'error';
      percent?: number;
      message?: string;
    }) => listener(payload);
    ipcRenderer.on('ai:event', wrapped);
    return () => ipcRenderer.removeListener('ai:event', wrapped);
  },

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
