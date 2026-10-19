import { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url';

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

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt || input.shift || input.isComposing) return;
    if (!(input.control || input.meta)) return;
    if (input.key.toLowerCase() !== 'y') return;
    event.preventDefault();
    mainWindow?.webContents.send('menu:redo');
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
  bootSession();
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
  try {
    const meta = readMetaSync();
    writeMetaSync({ ...meta, unclean: false });
  } catch {
    // Quitting should not be blocked by a session-file failure.
  }
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

// ── Project files, recents, and crash recovery ───────────────────────────────
// recoveryKind stays in sync with src/utils/sessionStore.ts.

const MAX_TEXT_BYTES = 8_000_000;

interface MainSessionMeta {
  unclean: boolean;
  dirty: boolean;
  projectPath: string | null;
  autosaveUpdatedAt: string | null;
  lastSaveAt: string | null;
  pendingKind: 'crash' | 'autosave' | null;
}

let launchRecoveryKind: 'crash' | 'autosave' | null = null;

function sessionDirectory(): string {
  return path.join(app.getPath('userData'), 'editpro-session');
}

function sessionPath(name: string): string {
  return path.join(sessionDirectory(), name);
}

function emptyMeta(): MainSessionMeta {
  return {
    unclean: false,
    dirty: false,
    projectPath: null,
    autosaveUpdatedAt: null,
    lastSaveAt: null,
    pendingKind: null,
  };
}

function recoveryKind(meta: MainSessionMeta, hasAutosave: boolean): 'crash' | 'autosave' | null {
  if (!hasAutosave || !meta.dirty) return null;
  return meta.unclean ? 'crash' : 'autosave';
}

function readMetaSync(): MainSessionMeta {
  try {
    const parsed = JSON.parse(fsSync.readFileSync(sessionPath('session.json'), 'utf8')) as Partial<MainSessionMeta>;
    const pendingKind = parsed.pendingKind === 'crash' || parsed.pendingKind === 'autosave' ? parsed.pendingKind : null;
    return {
      unclean: Boolean(parsed.unclean),
      dirty: Boolean(parsed.dirty),
      projectPath: typeof parsed.projectPath === 'string' ? parsed.projectPath : null,
      autosaveUpdatedAt: typeof parsed.autosaveUpdatedAt === 'string' ? parsed.autosaveUpdatedAt : null,
      lastSaveAt: typeof parsed.lastSaveAt === 'string' ? parsed.lastSaveAt : null,
      pendingKind,
    };
  } catch {
    return emptyMeta();
  }
}

function writeMetaSync(meta: MainSessionMeta): void {
  fsSync.mkdirSync(sessionDirectory(), { recursive: true });
  atomicWriteSync(sessionPath('session.json'), JSON.stringify(meta));
}

function atomicWriteSync(filePath: string, contents: string): void {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fsSync.writeFileSync(tmp, contents, 'utf8');
  fsSync.renameSync(tmp, filePath);
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, contents, 'utf8');
  await fs.rename(tmp, filePath);
}

function assertPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0')) {
    throw new Error('Invalid file path');
  }
  return value;
}

function assertText(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT_BYTES) {
    throw new Error('Invalid file contents');
  }
  return value;
}

function assertProjectPath(value: unknown): string {
  const filePath = assertPath(value);
  if (!filePath.toLowerCase().endsWith('.editpro')) {
    throw new Error('Project files must use the .editpro extension');
  }
  return filePath;
}

function optionalProjectPath(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return assertPath(value);
}

function bootSession(): void {
  try {
    fsSync.mkdirSync(sessionDirectory(), { recursive: true });
    const previous = readMetaSync();
    let autosave = '';
    try {
      autosave = fsSync.readFileSync(sessionPath('autosave.editpro'), 'utf8');
    } catch {
      autosave = '';
    }
    launchRecoveryKind = recoveryKind(previous, Boolean(autosave.trim()));
    writeMetaSync({
      unclean: true,
      dirty: Boolean(launchRecoveryKind),
      projectPath: previous.projectPath,
      autosaveUpdatedAt: previous.autosaveUpdatedAt,
      lastSaveAt: previous.lastSaveAt,
      pendingKind: launchRecoveryKind,
    });
  } catch (error) {
    console.error('EditPro session boot failed', error);
    launchRecoveryKind = null;
  }
}

function readRecovery(): {
  kind: 'crash' | 'autosave';
  autosave: string;
  projectPath: string | null;
  savedAt: string | null;
} | null {
  if (!launchRecoveryKind) return null;
  const meta = readMetaSync();
  if (!meta.dirty) return null;
  try {
    const autosave = fsSync.readFileSync(sessionPath('autosave.editpro'), 'utf8');
    if (!autosave.trim()) return null;
    return {
      kind: launchRecoveryKind,
      autosave,
      projectPath: meta.projectPath,
      savedAt: meta.autosaveUpdatedAt,
    };
  } catch {
    return null;
  }
}

function rememberAutosave(contents: string, projectPath: string | null): void {
  fsSync.mkdirSync(sessionDirectory(), { recursive: true });
  atomicWriteSync(sessionPath('autosave.editpro'), contents);
  const meta = readMetaSync();
  writeMetaSync({
    ...meta,
    unclean: true,
    dirty: true,
    projectPath,
    autosaveUpdatedAt: new Date().toISOString(),
  });
}

ipcMain.handle('dialog:openProject', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open EditPro Project',
    filters: [
      { name: 'EditPro Project', extensions: ['editpro'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
});

ipcMain.handle('dialog:saveProject', async (_event, defaultName: string) => {
  if (!mainWindow) return null;
  const suggested = typeof defaultName === 'string' && defaultName.trim() ? defaultName : 'Untitled.editpro';
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save EditPro Project',
    defaultPath: suggested.toLowerCase().endsWith('.editpro') ? suggested : `${suggested}.editpro`,
    filters: [{ name: 'EditPro Project', extensions: ['editpro'] }],
  });
  if (canceled || !filePath) return null;
  return filePath.toLowerCase().endsWith('.editpro') ? filePath : `${filePath}.editpro`;
});

ipcMain.handle('fs:readTextFile', async (_event, filePath: unknown) => {
  return fs.readFile(assertPath(filePath), 'utf8');
});

ipcMain.handle('fs:writeTextFile', async (_event, filePath: unknown, contents: unknown) => {
  await atomicWrite(assertProjectPath(filePath), assertText(contents));
  return true;
});

ipcMain.handle('recent:read', async () => {
  try {
    return await fs.readFile(sessionPath('recent.json'), 'utf8');
  } catch {
    return '[]';
  }
});

ipcMain.handle('recent:write', async (_event, contents: unknown) => {
  const text = assertText(contents);
  JSON.parse(text);
  fsSync.mkdirSync(sessionDirectory(), { recursive: true });
  await atomicWrite(sessionPath('recent.json'), text);
  return true;
});

ipcMain.handle('session:getRecovery', () => readRecovery());

ipcMain.handle('session:autosave', async (_event, contents: unknown, projectPath: unknown) => {
  rememberAutosave(assertText(contents), optionalProjectPath(projectPath));
  return true;
});

ipcMain.on('session:autosaveSync', (event, contents: unknown, projectPath: unknown) => {
  try {
    rememberAutosave(assertText(contents), optionalProjectPath(projectPath));
    event.returnValue = true;
  } catch {
    event.returnValue = false;
  }
});

ipcMain.handle('session:noteSaved', (_event, projectPath: unknown) => {
  const meta = readMetaSync();
  writeMetaSync({
    ...meta,
    dirty: false,
    projectPath: assertPath(projectPath),
    lastSaveAt: new Date().toISOString(),
  });
  return true;
});

ipcMain.handle('session:discardRecovery', async () => {
  await fs.rm(sessionPath('autosave.editpro'), { force: true });
  const meta = readMetaSync();
  writeMetaSync({ ...meta, dirty: false, autosaveUpdatedAt: null, pendingKind: null });
  launchRecoveryKind = null;
  return true;
});

ipcMain.handle('session:markClean', () => {
  const meta = readMetaSync();
  writeMetaSync({ ...meta, unclean: false });
  return true;
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
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:openProject'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu:saveAs'),
        },
        { type: 'separator' },
        {
          label: 'Import Image…',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow?.webContents.send('menu:openImage'),
        },
        {
          label: 'Import Video…',
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
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow?.webContents.send('menu:undo'),
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => mainWindow?.webContents.send('menu:redo'),
        },
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
