import { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme, protocol, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  APP_ORIGIN,
  APP_SCHEME,
  FileAccessGrants,
  buildContentSecurityPolicy,
  canonicalizePath,
  contentTypeForPath,
  decodeImageDataUrl,
  isDevToolsUrl,
  isNavigationAllowed,
  isPathInside,
  isTrustedIpcFrame,
  mediaPathsInsideDirectory,
  mimeTypeForRead,
  parseAllowedExternalUrl,
  resolveAppStaticPath,
  sanitizeSaveFileName,
} from './security.js';
import type { NavigationOptions } from './security.js';
import { parseExportJob, ExportPlanError, type ExportJob } from './export/plan.js';
import { cancelAllExports, cancelExportJob, hasActiveExport, probeEncoders, runFfmpegExport } from './export/runner.js';
import { ensureFfmpegExecutable, locateFfmpegBinary } from './export/ffmpegLocate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

/**
 * `app` is a standard, secure scheme so packaged pages are not `file://`.
 * Must run before `app.ready`.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// ── Window management ────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
const fileGrants = new FileAccessGrants();

function devServerPort(): string {
  const port = process.env.DEV_PORT ?? '5173';
  return /^\d+$/.test(port) ? port : '5173';
}

function navigationOptions(): NavigationOptions {
  return { isDev, devPort: devServerPort() };
}

function assertTrustedIpcSender(event: {
  sender: Electron.WebContents;
  senderFrame: Electron.WebFrameMain | null;
}): void {
  const frame = event.senderFrame;
  const trusted =
    !event.sender.isDestroyed() &&
    frame != null &&
    frame === event.sender.mainFrame &&
    isTrustedIpcFrame(
      { origin: frame.origin, url: frame.url, parent: frame.parent },
      navigationOptions(),
    );
  if (!trusted) {
    throw new Error('Unauthorized IPC sender');
  }
}

async function openAllowedExternal(url: string): Promise<void> {
  const safeUrl = parseAllowedExternalUrl(url);
  if (!safeUrl) {
    throw new Error('Refusing to open a URL that is not https or mailto');
  }
  await shell.openExternal(safeUrl);
}

function registerAppProtocol(): void {
  const distRoot = path.resolve(__dirname, '../dist');
  protocol.handle(APP_SCHEME, async (request) => {
    const filePath = resolveAppStaticPath(distRoot, request.url);
    if (!filePath) return new Response('Forbidden', { status: 403 });
    try {
      const body = await fs.readFile(filePath);
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: {
          'Content-Type': contentTypeForPath(filePath),
          'Content-Security-Policy': buildContentSecurityPolicy(navigationOptions()),
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR') {
        return new Response('Not found', { status: 404 });
      }
      return new Response('Forbidden', { status: 403 });
    }
  });
}

function installContentSecurityPolicy(): void {
  const policy = buildContentSecurityPolicy(navigationOptions());
  const port = devServerPort();
  const urls = isDev
    ? [`http://localhost:${port}/*`, `http://127.0.0.1:${port}/*`]
    : [`${APP_SCHEME}://*/*`];
  session.defaultSession.webRequest.onHeadersReceived({ urls }, (details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

function installPermissionHandlers(): void {
  session.defaultSession.setPermissionRequestHandler((webContents, _permission, callback) => {
    callback(isDevToolsUrl(webContents.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, _permission, requestingOrigin) => {
    if (isDevToolsUrl(requestingOrigin)) return true;
    return webContents != null && isDevToolsUrl(webContents.getURL());
  });
}

function installNavigationGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });

    const preventUnexpectedNavigation = (targetUrl: string, preventDefault: () => void) => {
      if (!isNavigationAllowed(contents.getURL(), targetUrl, navigationOptions())) {
        preventDefault();
      }
    };

    contents.on('will-navigate', (event) => {
      preventUnexpectedNavigation(event.url, () => event.preventDefault());
    });
    contents.on('will-frame-navigate', (event) => {
      preventUnexpectedNavigation(event.url, () => event.preventDefault());
    });
    contents.on('will-redirect', (event) => {
      preventUnexpectedNavigation(event.url, () => event.preventDefault());
    });
  });
}

function createWindow() {
  restoreGrants();
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
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
      webviewTag: false,
    },
    // macOS-specific: hide default title bar for a cleaner look
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false, // show after ready-to-show to avoid flash
  });

  // Show once ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`EditPro failed to load ${url}: ${code} ${description}`);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt || input.shift || input.isComposing) return;
    if (!(input.control || input.meta)) return;
    if (input.key.toLowerCase() !== 'y') return;
    event.preventDefault();
    mainWindow?.webContents.send('menu:redo');
  });

  if (isDev) {
    void mainWindow.loadURL(`http://localhost:${devServerPort()}`);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }

  mainWindow.on('closed', () => {
    fileGrants.clear();
    mainWindow = null;
  });
}

// Never click through a certificate error.
app.on('certificate-error', (_event, _webContents, _url, _error, _certificate, callback) => {
  callback(false);
});

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: 'EditPro',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 Jax Harlan',
    website: 'https://github.com/Unwrenchable/EditPro',
  });
  registerAppProtocol();
  installContentSecurityPolicy();
  installPermissionHandlers();
  installNavigationGuards();
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
  cancelAllExports();
  try {
    const meta = readMetaSync();
    writeMetaSync({ ...meta, unclean: false });
  } catch {
    // Quitting should not be blocked by a session-file failure.
  }
});

// ── IPC: File dialogs ────────────────────────────────────────────────────────

/** Open one or more image files */
ipcMain.handle('dialog:openImage', async (event) => {
  assertTrustedIpcSender(event);
  const parent = BrowserWindow.fromWebContents(event.sender);
  if (!parent) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
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
  for (const filePath of filePaths) fileGrants.grantRead(filePath);
  persistGrants();
  return filePaths;
});

/** Open a video file */
ipcMain.handle('dialog:openVideo', async (event) => {
  assertTrustedIpcSender(event);
  const parent = BrowserWindow.fromWebContents(event.sender);
  if (!parent) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
    title: 'Open Video',
    filters: [
      { name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'flv', 'wmv'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return null;
  fileGrants.grantRead(filePaths[0]);
  persistGrants();
  return filePaths[0];
});

/** Save an exported image */
ipcMain.handle('dialog:saveImage', async (event, defaultName: unknown) => {
  assertTrustedIpcSender(event);
  const parent = BrowserWindow.fromWebContents(event.sender);
  if (!parent) return null;
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: 'Save Image',
    defaultPath: sanitizeSaveFileName(defaultName),
    filters: [
      { name: 'PNG Image', extensions: ['png'] },
      { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
      { name: 'WebP Image', extensions: ['webp'] },
    ],
  });
  if (canceled || !filePath) return null;
  fileGrants.grantWrite(filePath);
  persistGrants();
  return filePath;
});

/** Read a file the user picked and return its base64 data URL */
ipcMain.handle('fs:readFileAsDataUrl', async (event, filePath: unknown) => {
  assertTrustedIpcSender(event);
  const allowed = fileGrants.assertCanRead(filePath);
  const info = await fs.stat(allowed);
  if (!info.isFile()) {
    throw new Error('Refusing to read a path that is not a file');
  }
  const data = await fs.readFile(allowed);
  return `data:${mimeTypeForRead(allowed)};base64,${data.toString('base64')}`;
});

/** Write a base64 image data URL to a path the user picked in the save dialog */
ipcMain.handle('fs:writeDataUrlToFile', async (event, filePath: unknown, dataUrl: unknown) => {
  assertTrustedIpcSender(event);
  const bytes = decodeImageDataUrl(dataUrl);
  const allowed = fileGrants.consumeWrite(filePath);
  try {
    const info = await fs.lstat(allowed);
    if (info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Refusing to write a directory or symbolic link');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await fs.writeFile(allowed, bytes);
  persistGrants();
  return true;
});

function videoSaveName(name: unknown): { fileName: string; ext: 'mp4' | 'webm' | 'mov' } {
  const fallback = 'editpro-export.mp4';
  const base = sanitizeSaveFileName(name, fallback);
  const ext = path.extname(base).slice(1).toLowerCase();
  if (ext === 'webm' || ext === 'mov' || ext === 'mp4') {
    return { fileName: base, ext };
  }
  return { fileName: fallback, ext: 'mp4' };
}

/** Save an exported video */
ipcMain.handle('dialog:saveVideo', async (event, defaultName: unknown) => {
  assertTrustedIpcSender(event);
  const parent = BrowserWindow.fromWebContents(event.sender);
  if (!parent) return null;
  const { fileName, ext } = videoSaveName(defaultName);
  const filters =
    ext === 'webm'
      ? [{ name: 'WebM Video', extensions: ['webm'] }]
      : ext === 'mov'
        ? [{ name: 'QuickTime Movie', extensions: ['mov'] }]
        : [{ name: 'MP4 Video (H.264)', extensions: ['mp4'] }];
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: 'Export Video',
    defaultPath: fileName,
    filters,
  });
  if (canceled || !filePath) return null;
  fileGrants.grantWrite(filePath);
  persistGrants();
  return filePath;
});

function exportErrorMessage(error: unknown): string {
  if (error instanceof ExportPlanError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Export failed.';
}

function exportTempRoot(): string {
  return path.join(app.getPath('temp'), 'editpro-export');
}

function isTempExportSource(filePath: string): boolean {
  try {
    return isPathInside(exportTempRoot(), filePath);
  } catch {
    return false;
  }
}

async function assertRegularFileOrMissing(filePath: string): Promise<void> {
  try {
    const info = await fs.lstat(filePath);
    if (info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Refusing to write a directory or symbolic link');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** ffmpeg may read a granted source or a temp file this process just materialized. */
async function assertExportInput(filePath: string): Promise<string> {
  const canonical = canonicalizePath(filePath);
  const allowed = fileGrants.hasRead(canonical) || isTempExportSource(canonical);
  if (!allowed) {
    throw new Error('Refusing to read a video that was not opened in EditPro');
  }
  const info = await fs.lstat(canonical);
  if (!info.isFile()) {
    throw new Error('A source video was not found. Re-open it from disk and try again.');
  }
  return canonical;
}

/** Copy a renderer File (no disk path) into a temp file ffmpeg can read. */
ipcMain.handle('export:materializeSource', async (event, fileName: unknown, bytes: unknown) => {
  assertTrustedIpcSender(event);
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
  const dir = exportTempRoot();
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${Date.now()}-${safeName}`);
  await fs.writeFile(dest, view);
  fileGrants.grantRead(dest, { ephemeral: true });
  return dest;
});

let encoderList: Promise<string[]> | null = null;

/** Hardware and software encoders this ffmpeg build can use. */
ipcMain.handle('export:encoders', async (event) => {
  assertTrustedIpcSender(event);
  if (!encoderList) {
    encoderList = (async () => {
      try {
        const ffmpegPath = locateFfmpegBinary({
          packaged: app.isPackaged,
          platform: process.platform,
          resourcesPath: process.resourcesPath,
        });
        await ensureFfmpegExecutable(ffmpegPath, process.platform);
        return await probeEncoders(ffmpegPath);
      } catch {
        return [];
      }
    })();
  }
  return encoderList;
});

/** Encode the edit with the bundled ffmpeg binary. Progress arrives on `export:event`. */
ipcMain.handle('export:start', async (event, payload: unknown) => {
  assertTrustedIpcSender(event);
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
      job.sourcePath = await assertExportInput(job.sourcePath);
      for (const clip of job.clips) {
        clip.sourcePath = await assertExportInput(clip.sourcePath);
      }
      job.outputPath = fileGrants.assertCanWrite(job.outputPath);
      await assertRegularFileOrMissing(job.outputPath);
    } catch (error) {
      throw new Error(exportErrorMessage(error));
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
    if (result.status === 'done') {
      fileGrants.grantRead(result.outputPath);
      persistGrants();
    }
    return result;
  } finally {
    if (isTempExportSource(job.sourcePath)) {
      await fs.unlink(job.sourcePath).catch(() => undefined);
    }
  }
});

ipcMain.handle('export:cancel', async (event, jobId: unknown) => {
  assertTrustedIpcSender(event);
  if (typeof jobId !== 'string' || jobId.length === 0) return false;
  cancelExportJob(jobId);
  return true;
});

/** Reveal a file the user opened or exported. */
ipcMain.handle('shell:showItemInFolder', (event, filePath: unknown) => {
  assertTrustedIpcSender(event);
  if (!fileGrants.hasRead(filePath) && !fileGrants.hasWrite(filePath)) return false;
  try {
    shell.showItemInFolder(canonicalizePath(filePath));
    return true;
  } catch {
    return false;
  }
});

/**
 * A real File from the renderer file picker or a drop. webUtils.getPathForFile
 * only resolves OS-backed files, so the preload is the one that sends the path.
 */
ipcMain.on('fs:grantPickedFile', (event, filePath: unknown) => {
  event.returnValue = false;
  try {
    assertTrustedIpcSender(event);
    const canonical = canonicalizePath(filePath);
    const info = fsSync.statSync(canonical);
    if (!info.isFile()) return;
    fileGrants.grantRead(canonical);
    persistGrants();
    event.returnValue = true;
  } catch {
    event.returnValue = false;
  }
});

/** Get app version */
ipcMain.handle('app:getVersion', (event) => {
  assertTrustedIpcSender(event);
  return app.getVersion();
});

/** Get platform */
ipcMain.handle('app:getPlatform', (event) => {
  assertTrustedIpcSender(event);
  return process.platform;
});

/** Open an https or mailto URL in the default handler */
ipcMain.handle('shell:openExternal', async (event, url: unknown) => {
  assertTrustedIpcSender(event);
  if (typeof url !== 'string') {
    throw new Error('Refusing to open a URL that is not https or mailto');
  }
  await openAllowedExternal(url);
  return true;
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

/** Only record a project path the user has already been allowed to open or save. */
function grantedProjectPath(value: unknown): string | null {
  const filePath = optionalProjectPath(value);
  if (!filePath) return null;
  if (!fileGrants.hasRead(filePath) && !fileGrants.hasWrite(filePath)) return null;
  return canonicalizePath(filePath);
}

function persistGrants(): void {
  try {
    fsSync.mkdirSync(sessionDirectory(), { recursive: true });
    atomicWriteSync(sessionPath('grants.json'), JSON.stringify(fileGrants.snapshot()));
  } catch (error) {
    console.error('EditPro could not persist file grants', error);
  }
}

function restoreGrants(): void {
  try {
    const parsed = JSON.parse(fsSync.readFileSync(sessionPath('grants.json'), 'utf8')) as {
      read?: unknown;
      write?: unknown;
    };
    const reads = Array.isArray(parsed.read) ? parsed.read : [];
    const writes = Array.isArray(parsed.write) ? parsed.write : [];
    for (const entry of reads) {
      if (typeof entry !== 'string') continue;
      try {
        fileGrants.grantRead(entry);
      } catch {
        // Skip a grant the canonicalizer rejects.
      }
    }
    for (const entry of writes) {
      if (typeof entry !== 'string') continue;
      try {
        fileGrants.grantWrite(entry);
      } catch {
        // Skip a grant the canonicalizer rejects.
      }
    }
  } catch {
    // First launch, or the grant file is unreadable.
  }
}

function grantProjectMedia(projectPath: string, contents: string): void {
  for (const mediaPath of mediaPathsInsideDirectory(projectPath, contents)) {
    fileGrants.grantRead(mediaPath);
  }
  persistGrants();
}

function rememberProjectPath(filePath: string): void {
  fileGrants.grantRead(filePath);
  fileGrants.grantWrite(filePath);
  persistGrants();
}

function bootSession(): void {
  try {
    fsSync.mkdirSync(sessionDirectory(), { recursive: true });
    restoreGrants();
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
    if (meta.projectPath && (fileGrants.hasRead(meta.projectPath) || fileGrants.hasWrite(meta.projectPath))) {
      grantProjectMedia(meta.projectPath, autosave);
    }
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

function projectSaveName(name: unknown): string {
  const base = sanitizeSaveFileName(name, 'Untitled.editpro');
  return base.toLowerCase().endsWith('.editpro') ? base : `${base}.editpro`;
}

ipcMain.handle('dialog:openProject', async (event) => {
  assertTrustedIpcSender(event);
  const parent = BrowserWindow.fromWebContents(event.sender);
  if (!parent) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
    title: 'Open EditPro Project',
    filters: [
      { name: 'EditPro Project', extensions: ['editpro'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return null;
  rememberProjectPath(filePaths[0]);
  return filePaths[0];
});

ipcMain.handle('dialog:saveProject', async (event, defaultName: unknown) => {
  assertTrustedIpcSender(event);
  const parent = BrowserWindow.fromWebContents(event.sender);
  if (!parent) return null;
  const suggested = projectSaveName(defaultName);
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: 'Save EditPro Project',
    defaultPath: suggested,
    filters: [{ name: 'EditPro Project', extensions: ['editpro'] }],
  });
  if (canceled || !filePath) return null;
  const destination = filePath.toLowerCase().endsWith('.editpro') ? filePath : `${filePath}.editpro`;
  rememberProjectPath(destination);
  return destination;
});

ipcMain.handle('fs:readTextFile', async (event, filePath: unknown) => {
  assertTrustedIpcSender(event);
  const allowed = fileGrants.assertCanRead(filePath);
  const info = await fs.lstat(allowed);
  if (!info.isFile()) throw new Error('Refusing to read a path that is not a file');
  const contents = await fs.readFile(allowed, 'utf8');
  if (allowed.toLowerCase().endsWith('.editpro')) grantProjectMedia(allowed, contents);
  return contents;
});

ipcMain.handle('fs:writeTextFile', async (event, filePath: unknown, contents: unknown) => {
  assertTrustedIpcSender(event);
  const text = assertText(contents);
  const allowed = fileGrants.assertCanWrite(assertProjectPath(filePath));
  await assertRegularFileOrMissing(allowed);
  await atomicWrite(allowed, text);
  fileGrants.grantRead(allowed);
  grantProjectMedia(allowed, text);
  return true;
});

ipcMain.handle('recent:read', async (event) => {
  assertTrustedIpcSender(event);
  try {
    return await fs.readFile(sessionPath('recent.json'), 'utf8');
  } catch {
    return '[]';
  }
});

ipcMain.handle('recent:write', async (event, contents: unknown) => {
  assertTrustedIpcSender(event);
  const text = assertText(contents);
  JSON.parse(text);
  fsSync.mkdirSync(sessionDirectory(), { recursive: true });
  await atomicWrite(sessionPath('recent.json'), text);
  return true;
});

ipcMain.handle('session:getRecovery', (event) => {
  assertTrustedIpcSender(event);
  return readRecovery();
});

ipcMain.handle('session:autosave', async (event, contents: unknown, projectPath: unknown) => {
  assertTrustedIpcSender(event);
  rememberAutosave(assertText(contents), grantedProjectPath(projectPath));
  return true;
});

ipcMain.on('session:autosaveSync', (event, contents: unknown, projectPath: unknown) => {
  try {
    assertTrustedIpcSender(event);
    rememberAutosave(assertText(contents), grantedProjectPath(projectPath));
    event.returnValue = true;
  } catch {
    event.returnValue = false;
  }
});

ipcMain.handle('session:noteSaved', (event, projectPath: unknown) => {
  assertTrustedIpcSender(event);
  const allowed = grantedProjectPath(projectPath);
  if (!allowed) throw new Error('Refusing to record a project path that was not opened or saved');
  const meta = readMetaSync();
  writeMetaSync({
    ...meta,
    dirty: false,
    projectPath: allowed,
    lastSaveAt: new Date().toISOString(),
  });
  return true;
});

ipcMain.handle('session:discardRecovery', async (event) => {
  assertTrustedIpcSender(event);
  await fs.rm(sessionPath('autosave.editpro'), { force: true });
  const meta = readMetaSync();
  writeMetaSync({ ...meta, dirty: false, autosaveUpdatedAt: null, pendingKind: null });
  launchRecoveryKind = null;
  return true;
});

ipcMain.handle('session:markClean', (event) => {
  assertTrustedIpcSender(event);
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
          click: () => {
            void openAllowedExternal('https://github.com/Unwrenchable/EditPro');
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
