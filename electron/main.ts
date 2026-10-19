import { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseExportJob, ExportPlanError, type ExportJob } from './export/plan.js';
import { cancelAllExports, cancelExportJob, hasActiveExport, runFfmpegExport } from './export/runner.js';
import { ensureFfmpegExecutable, locateFfmpegBinary } from './export/ffmpegLocate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ── Window management ────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;

function createWindow() {
  nativeTheme.themeSource = 'dark';

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'EditPro',
    backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    // macOS-specific: hide default title bar for a cleaner look
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false, // show after ready-to-show to avoid flash
  });

  // Show once ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev) {
    const devPort = process.env.DEV_PORT ?? '5173';
    void mainWindow.loadURL(`http://localhost:${devPort}`);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildApplicationMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  cancelAllExports();
});

// ── IPC: File dialogs ────────────────────────────────────────────────────────

/** Open one or more image files */
ipcMain.handle('dialog:openImage', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Image',
    filters: [
      {
        name: 'Images',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif'],
      },
      { name: 'RAW Images', extensions: ['raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths;
});

/** Open a video file */
ipcMain.handle('dialog:openVideo', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Video',
    filters: [
      { name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'flv', 'wmv'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
});

/** Save an exported image */
ipcMain.handle('dialog:saveImage', async (_event, defaultName: string) => {
  if (!mainWindow) return null;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Image',
    defaultPath: defaultName,
    filters: [
      { name: 'PNG Image', extensions: ['png'] },
      { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
      { name: 'WebP Image', extensions: ['webp'] },
    ],
  });
  if (canceled || !filePath) return null;
  return filePath;
});

/** Read a file and return its base64 data URL */
ipcMain.handle('fs:readFileAsDataUrl', async (_event, filePath: string) => {
  const data = await fs.readFile(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
  };
  const mime = mimeMap[ext] ?? 'application/octet-stream';
  return `data:${mime};base64,${data.toString('base64')}`;
});

/** Write a base64 data URL to a file path */
ipcMain.handle('fs:writeDataUrlToFile', async (_event, filePath: string, dataUrl: string) => {
  const base64 = dataUrl.split(',')[1];
  if (!base64) throw new Error('Invalid data URL');
  await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
  return true;
});

/** Save an exported video */
ipcMain.handle('dialog:saveVideo', async (_event, defaultName: string) => {
  if (!mainWindow) return null;
  const safeName = typeof defaultName === 'string' && defaultName.trim() ? defaultName : 'editpro-export.mp4';
  const ext = path.extname(safeName).slice(1).toLowerCase();
  const filters =
    ext === 'webm'
      ? [{ name: 'WebM Video', extensions: ['webm'] }]
      : ext === 'mov'
        ? [{ name: 'QuickTime Movie', extensions: ['mov'] }]
        : [{ name: 'MP4 Video (H.264)', extensions: ['mp4'] }];
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Video',
    defaultPath: safeName,
    filters,
  });
  if (canceled || !filePath) return null;
  return filePath;
});

function exportErrorMessage(error: unknown): string {
  if (error instanceof ExportPlanError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Export failed.';
}

function isTempExportSource(filePath: string): boolean {
  const root = path.resolve(path.join(app.getPath('temp'), 'editpro-export'));
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/** Copy a renderer File (no disk path) into a temp file ffmpeg can read. */
ipcMain.handle('export:materializeSource', async (_event, fileName: unknown, bytes: unknown) => {
  const rawName = typeof fileName === 'string' ? fileName : 'source.mp4';
  const safeName = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_') || 'source.mp4';
  if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) {
    throw new Error('Could not read the source video.');
  }
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const maxBytes = 1.5 * 1024 * 1024 * 1024;
  if (view.byteLength <= 0) throw new Error('The source video is empty.');
  if (view.byteLength > maxBytes) {
    throw new Error('This video is too large to copy into the export temp folder. Open it from disk in the desktop app so ffmpeg can read the original file.');
  }
  const dir = path.join(app.getPath('temp'), 'editpro-export');
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${Date.now()}-${safeName}`);
  await fs.writeFile(dest, view);
  return dest;
});

/** Encode the edit with the bundled ffmpeg binary. Progress arrives on `export:event`. */
ipcMain.handle('export:start', async (event, payload: unknown) => {
  if (hasActiveExport()) {
    throw new Error('An export is already running. Cancel it before starting another.');
  }
  let job: ExportJob;
  try {
    job = parseExportJob(payload);
  } catch (error) {
    throw new Error(exportErrorMessage(error));
  }
  try {
    try {
      await fs.access(job.sourcePath);
      for (const clip of job.clips) await fs.access(clip.sourcePath);
    } catch {
      throw new Error('A source video was not found. Re-open it from disk and try again.');
    }
    let ffmpegPath: string;
    try {
      ffmpegPath = locateFfmpegBinary({
        packaged: app.isPackaged,
        platform: process.platform,
        resourcesPath: process.resourcesPath,
      });
      await ensureFfmpegExecutable(ffmpegPath, process.platform);
    } catch (error) {
      throw new Error(exportErrorMessage(error));
    }

    const result = await runFfmpegExport({
      ffmpegPath,
      job,
      onProgress: (update) => {
        if (event.sender.isDestroyed()) return;
        event.sender.send('export:event', { jobId: job.jobId, type: 'progress', ...update });
      },
    });

    if (!event.sender.isDestroyed()) {
      event.sender.send('export:event', {
        jobId: job.jobId,
        type: result.status,
        outputPath: result.outputPath,
        message: result.message,
        percent: result.status === 'done' ? 100 : undefined,
      });
    }
    return result;
  } finally {
    if (isTempExportSource(job.sourcePath)) {
      await fs.unlink(job.sourcePath).catch(() => undefined);
    }
  }
});

ipcMain.handle('export:cancel', async (_event, jobId: unknown) => {
  if (typeof jobId !== 'string' || jobId.length === 0) return false;
  cancelExportJob(jobId);
  return true;
});

/** Reveal an exported file in Explorer, Finder, or the file manager. */
ipcMain.handle('shell:showItemInFolder', (_event, filePath: unknown) => {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return false;
  shell.showItemInFolder(filePath);
  return true;
});

/** Get app version */
ipcMain.handle('app:getVersion', () => app.getVersion());

/** Get platform */
ipcMain.handle('app:getPlatform', () => process.platform);

/** Open a URL in the default browser */
ipcMain.handle('shell:openExternal', (_event, url: string) => {
  // Only allow https URLs for safety
  if (url.startsWith('https://')) {
    void shell.openExternal(url);
  }
});

// ── Application menu ─────────────────────────────────────────────────────────

function buildApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu
    ...(isMac
      ? ([
          {
            label: 'EditPro',
            submenu: [
              { role: 'about', label: 'About EditPro' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide', label: 'Hide EditPro' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit', label: 'Quit EditPro' },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),

    // File menu
    {
      label: '&File',
      submenu: [
        {
          label: 'Open Image…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:openImage'),
        },
        {
          label: 'Open Video…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow?.webContents.send('menu:openVideo'),
        },
        { type: 'separator' },
        {
          label: 'Export…',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('menu:export'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },

    // Edit menu
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
        { type: 'separator' as const },
        {
          label: 'Reset Adjustments',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => mainWindow?.webContents.send('menu:resetAdjustments'),
        },
      ],
    },

    // View menu
    {
      label: '&View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
        ...(isDev
          ? [{ type: 'separator' as const }, { role: 'toggleDevTools' as const }]
          : []),
      ],
    },

    // Window menu
    {
      label: '&Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }]),
      ],
    },

    // Help menu
    {
      role: 'help' as const,
      submenu: [
        {
          label: 'Learn More',
          click: () => void shell.openExternal('https://github.com/Unwrenchable/EditPro'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
