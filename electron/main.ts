import { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme, protocol, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  APP_ORIGIN,
  APP_SCHEME,
  FileAccessGrants,
  buildContentSecurityPolicy,
  contentTypeForPath,
  decodeImageDataUrl,
  isDevToolsUrl,
  isNavigationAllowed,
  isTrustedIpcFrame,
  mimeTypeForRead,
  parseAllowedExternalUrl,
  resolveAppStaticPath,
  sanitizeSaveFileName,
} from './security.js';
import type { NavigationOptions } from './security.js';

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

function assertTrustedIpcSender(event: Electron.IpcMainInvokeEvent): void {
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
  buildApplicationMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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
  return true;
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
          click: () => {
            void openAllowedExternal('https://github.com/Unwrenchable/EditPro');
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
