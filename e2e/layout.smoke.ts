import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';
import { projectRoot, writeMediaFixture } from './launch';

const root = projectRoot();
const shotDir = path.join(root, 'e2e', 'results', 'layout');
const artifactDir = '/opt/cursor/artifacts/screenshots/after';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LayoutSnapshot {
  host: string | null;
  coarse: boolean;
  narrow: boolean;
  flex: string | null;
  touchClass: boolean;
  touchTimeline: boolean;
  proTimeline: boolean;
  viewport: string | null;
  dpr: number;
  inner: [number, number];
  main: Box | null;
  right: Box | null;
  video: Box | null;
  timeline: Box | null;
  touch: Box | null;
  multicam: Box | null;
  scopes: Box | null;
  motion: Box | null;
  dock: Box | null;
}

function overlapArea(a: Box | null, b: Box | null): number {
  if (!a || !b) return 0;
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

async function readLayout(page: Page): Promise<LayoutSnapshot> {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    };
    const layout = document.querySelector('.editor-layout');
    return {
      host: document.documentElement.dataset.host ?? null,
      coarse: window.matchMedia('(pointer: coarse)').matches,
      narrow: window.matchMedia('(max-width: 800px)').matches,
      flex: layout ? getComputedStyle(layout).flexDirection : null,
      touchClass: layout?.classList.contains('editor-layout-touch') ?? false,
      touchTimeline: Boolean(document.querySelector('.touch-timeline')),
      proTimeline: Boolean(document.querySelector('.pro-timeline')),
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null,
      dpr: window.devicePixelRatio,
      inner: [window.innerWidth, window.innerHeight] as [number, number],
      main: box('.editor-main'),
      right: box('.right-panel'),
      video: box('.video-container'),
      timeline: box('.pro-timeline'),
      touch: box('.touch-timeline'),
      multicam: box('.multicam-panel'),
      scopes: box('.video-scopes-panel'),
      motion: box('.motion-panel'),
      dock: box('.editor-dock'),
    };
  });
}

function installPreferences(kind: 'electron' | 'web') {
  const prefs = {
    automaticUpdateChecks: false,
    skippedVersion: null,
    snoozeUntil: null,
    crashLogging: false,
    onboardingComplete: true,
  };
  localStorage.setItem('editpro.preferences.v1', JSON.stringify(prefs));
  if (kind !== 'electron') return;
  const bridge = {
    get(_target: object, prop: string | symbol) {
      if (prop === 'getPreferences' || prop === 'setPreferences') return () => Promise.resolve(prefs);
      if (prop === 'getVersion') return () => Promise.resolve('1.0.0');
      if (prop === 'getUpdateState') return () => Promise.resolve({ type: 'hidden' });
      if (prop === 'getDecodeInfo') {
        return () => Promise.resolve({ videoDecode: 'software', hardware: false, label: 'Software', platform: 'win32' });
      }
      if (String(prop).startsWith('on')) return () => () => {};
      if (prop === 'getPathForFile') return () => '';
      return () => Promise.resolve(null);
    },
  };
  (window as unknown as { editpro: object }).editpro = new Proxy({}, bridge);
}

async function openEditor(page: Page, mode: 'Video' | 'Photo' = 'Video') {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.app').waitFor();
  await page.getByRole('button', { name: new RegExp(mode) }).click();
  await page.locator('.editor-layout').waitFor();
}

function assertSideBySide(layout: LayoutSnapshot) {
  expect(layout.flex, JSON.stringify(layout)).toBe('row');
  expect(layout.touchTimeline).toBe(false);
  expect(layout.touchClass).toBe(false);
  expect(layout.proTimeline).toBe(true);
  expect(layout.main).not.toBeNull();
  expect(layout.right).not.toBeNull();
  expect(overlapArea(layout.main, layout.right)).toBe(0);
  expect(layout.right!.x).toBeGreaterThanOrEqual(layout.main!.x + layout.main!.w - 1);
  expect(layout.right!.x + layout.right!.w).toBeLessThanOrEqual(layout.inner[0] + 1);
  expect(layout.main!.y + layout.main!.h).toBeLessThanOrEqual(layout.inner[1] + 1);
}

async function saveShot(page: Page, name: string) {
  fs.mkdirSync(shotDir, { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  const file = path.join(shotDir, name);
  await page.screenshot({ path: file });
  fs.copyFileSync(file, path.join(artifactDir, name));
  await test.info().attach(name, { path: file, contentType: 'image/png' });
}

let server: PreviewServer;
let browser: Browser;
let mediaFile = '';
let baseUrl = '';

test.beforeAll(async () => {
  const renderer = path.join(root, 'dist', 'index.html');
  if (!fs.existsSync(renderer)) {
    throw new Error('Build the renderer first with npm run build');
  }
  const mediaRoot = path.join(root, 'e2e', 'results');
  fs.mkdirSync(mediaRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(mediaRoot, 'layout-media-'));
  mediaFile = (await writeMediaFixture(work)).file;
  server = await preview({
    configFile: path.join(root, 'vite.config.ts'),
    preview: { host: '127.0.0.1', port: 0 },
  });
  const address = server.httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  if (!port) throw new Error('The layout preview server did not bind a port');
  baseUrl = `http://127.0.0.1:${port}/`;
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function contextFor(options: {
  width: number;
  height: number;
  kind: 'electron' | 'web';
  hasTouch: boolean;
}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: 1.25,
    hasTouch: options.hasTouch,
    isMobile: false,
  });
  await context.addInitScript(installPreferences, options.kind);
  const page = await context.newPage();
  return { context, page };
}

const desktopSizes = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
];

for (const size of desktopSizes) {
  test(`desktop Electron keeps the pro layout at ${size.width}x${size.height} with 125% scale and a coarse pointer`, async () => {
    const { context, page } = await contextFor({ ...size, kind: 'electron', hasTouch: true });
    try {
      await openEditor(page);
      const empty = await readLayout(page);
      expect(empty.host).toBe('electron');
      expect(empty.coarse).toBe(true);
      expect(empty.narrow).toBe(false);
      expect(empty.dpr).toBe(1.25);
      expect(empty.viewport).toBeNull();
      assertSideBySide(empty);

      await page.locator('input[aria-label="Open video file"]').first().setInputFiles(mediaFile);
      await page.locator('.editor-dock').waitFor();
      await expect(page.getByRole('tab', { name: 'Multicam' })).toHaveAttribute('aria-selected', 'true');
      const loaded = await readLayout(page);
      assertSideBySide(loaded);
      expect(loaded.video).not.toBeNull();
      expect(loaded.video!.h).toBeGreaterThanOrEqual(80);
      expect(loaded.dock).not.toBeNull();
      expect(loaded.multicam).not.toBeNull();
      expect(loaded.scopes).toBeNull();
      expect(loaded.motion).toBeNull();
      expect(overlapArea(loaded.timeline, loaded.dock)).toBe(0);
      expect(overlapArea(loaded.timeline, loaded.video)).toBe(0);
      expect(overlapArea(loaded.video, loaded.dock)).toBe(0);
      expect(loaded.dock!.y).toBeGreaterThanOrEqual(loaded.video!.y + loaded.video!.h - 1);
      expect(loaded.timeline!.y).toBeGreaterThanOrEqual(loaded.dock!.y + loaded.dock!.h - 1);

      await page.getByRole('tab', { name: 'Scopes' }).click();
      await expect(page.getByRole('tab', { name: 'Scopes' })).toHaveAttribute('aria-selected', 'true');
      const scopes = await readLayout(page);
      expect(scopes.multicam).toBeNull();
      expect(scopes.scopes).not.toBeNull();
      expect(scopes.video!.h).toBeGreaterThanOrEqual(80);
      expect(overlapArea(scopes.timeline, scopes.dock)).toBe(0);
      expect(overlapArea(scopes.timeline, scopes.video)).toBe(0);
      await saveShot(page, `after-electron-coarse-${size.width}x${size.height}.png`);
    } finally {
      await context.close();
    }
  });
}

test('desktop Electron stays on the pro timeline even when the window is narrower than 800px', async () => {
  const { context, page } = await contextFor({ width: 700, height: 600, kind: 'electron', hasTouch: true });
  try {
    await openEditor(page);
    const layout = await readLayout(page);
    expect(layout.host).toBe('electron');
    expect(layout.coarse).toBe(true);
    expect(layout.narrow).toBe(true);
    expect(layout.dpr).toBe(1.25);
    assertSideBySide(layout);
    await saveShot(page, 'after-electron-narrow-700x600.png');
  } finally {
    await context.close();
  }
});

test('a coarse pointer on a wide browser window does not select the phone layout', async () => {
  const { context, page } = await contextFor({ width: 1280, height: 720, kind: 'web', hasTouch: true });
  try {
    await openEditor(page);
    const layout = await readLayout(page);
    expect(layout.host).toBe('web');
    expect(layout.coarse).toBe(true);
    expect(layout.narrow).toBe(false);
    assertSideBySide(layout);
    await saveShot(page, 'after-web-coarse-1280x720.png');
  } finally {
    await context.close();
  }
});

test('a narrow browser window uses the touch timeline', async () => {
  const { context, page } = await contextFor({ width: 390, height: 780, kind: 'web', hasTouch: true });
  try {
    await openEditor(page);
    const layout = await readLayout(page);
    expect(layout.host).toBe('web');
    expect(layout.narrow).toBe(true);
    expect(layout.flex).toBe('column');
    expect(layout.touchTimeline).toBe(true);
    expect(layout.touchClass).toBe(true);
    expect(layout.proTimeline).toBe(false);
    expect(layout.right!.w).toBeGreaterThan(300);
    await saveShot(page, 'after-web-narrow-390x780.png');
  } finally {
    await context.close();
  }
});
