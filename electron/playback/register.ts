/**
 * IPC and media:// handler for proxy playback.
 * Proxy bytes stay in the userData cache. The renderer only receives a ticket URL.
 */
import { app, ipcMain, protocol, type WebContents } from 'electron';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { Readable } from 'node:stream';
import { ensureFfmpegExecutable, locateFfmpegBinary } from '../export/ffmpegLocate.js';
import { canonicalizePath, type NavigationOptions } from '../security.js';
import { summarizeDecodeStatus } from './hwDecode.js';
import {
  createMediaTicketId,
  mediaTicketIdFromUrl,
  mediaTicketUrl,
  planMediaResponse,
  resolveMediaAllowOrigin,
} from './mediaAccess.js';
import {
  assertExportSourceAllowed,
  canReadProxyFile,
  isInsideProxyCache,
  parseMediaProbe,
  parseProxyRequest,
  parseProxySidecar,
  PROXY_FORMAT_VERSION,
  proxyCacheFileName,
  proxyDimensions,
  proxyOutputPaths,
  serializeProxySidecar,
  type PlaybackScale,
  type ProxySidecar,
} from './proxyPlan.js';
import {
  acknowledgeProxyCancel,
  cancelAllProxyJobs,
  cancelProxyJob,
  isProxyJobCancelled,
  probeWithFfmpeg,
  runProxyEncode,
} from './proxyRunner.js';

export interface ProxyEvent {
  jobId: string;
  sourcePath: string;
  scale: PlaybackScale;
  type: 'progress' | 'done' | 'cancelled' | 'error';
  percent?: number;
  mediaUrl?: string;
  width?: number;
  height?: number;
  fps?: number;
  durationSec?: number;
  message?: string;
}

interface PlaybackDeps {
  assertTrusted: (event: { sender: WebContents; senderFrame: Electron.WebFrameMain | null }) => void;
  hasReadGrant: (filePath: string) => boolean;
  navigation: () => NavigationOptions;
  proxyRoot: () => string;
}

const tickets = new Map<string, string>();
const activeByKey = new Map<string, string>();

export function cancelAllProxies(): void {
  cancelAllProxyJobs();
  activeByKey.clear();
}

export function clearMediaTickets(): void {
  tickets.clear();
}

function issueTicket(filePath: string, proxyRoot: string): string {
  const canonical = canonicalizePath(filePath);
  if (!isInsideProxyCache(proxyRoot, canonical)) {
    throw new Error('Proxy media escaped the cache');
  }
  for (const [id, existing] of tickets) {
    if (existing === canonical) return mediaTicketUrl(id);
  }
  const id = createMediaTicketId();
  tickets.set(id, canonical);
  return mediaTicketUrl(id);
}

export function registerMediaProtocol(deps: PlaybackDeps): void {
  protocol.handle('media', async (request) => {
    const origin = resolveMediaAllowOrigin(request.headers.get('origin'), deps.navigation());
    const id = mediaTicketIdFromUrl(request.url);
    const ticketPath = id ? tickets.get(id) : undefined;
    let size = 0;
    let pathAllowed = false;
    if (ticketPath) {
      try {
        const info = await fsPromises.lstat(ticketPath);
        pathAllowed =
          canReadProxyFile({ isFile: info.isFile(), isSymbolicLink: info.isSymbolicLink() }) &&
          isInsideProxyCache(deps.proxyRoot(), ticketPath);
        size = info.size;
      } catch {
        pathAllowed = false;
      }
    }
    const plan = planMediaResponse({
      method: request.method,
      allowOrigin: origin,
      ticketFound: Boolean(ticketPath),
      pathAllowed,
      size,
      rangeHeader: request.headers.get('range'),
    });
    if (!plan.sendBody || !ticketPath) {
      return new Response(null, { status: plan.status, headers: plan.headers });
    }
    const nodeStream = fs.createReadStream(ticketPath, { start: plan.start, end: plan.end });
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new Response(webStream, { status: plan.status, headers: plan.headers });
  });
}

function send(sender: WebContents, payload: ProxyEvent): void {
  if (sender.isDestroyed()) return;
  sender.send('playback:event', payload);
}

async function locateFfmpeg(): Promise<string> {
  const ffmpegPath = locateFfmpegBinary({
    packaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
  });
  await ensureFfmpegExecutable(ffmpegPath, process.platform);
  return ffmpegPath;
}

export function registerPlaybackIpc(deps: PlaybackDeps): void {
  ipcMain.handle('playback:decodeInfo', (event) => {
    deps.assertTrusted(event);
    const status = app.getGPUFeatureStatus() as { video_decode?: string };
    const summary = summarizeDecodeStatus(status.video_decode);
    return {
      videoDecode: status.video_decode ?? 'unknown',
      hardware: summary.hardware,
      label: summary.label,
      platform: process.platform,
    };
  });

  ipcMain.handle('playback:cancelProxy', (event, jobId: unknown) => {
    deps.assertTrusted(event);
    if (typeof jobId !== 'string' || jobId.length === 0 || jobId.length > 80) return false;
    cancelProxyJob(jobId);
    return true;
  });

  ipcMain.handle('playback:startProxy', async (event, payload: unknown) => {
    deps.assertTrusted(event);
    const request = parseProxyRequest(payload);
    const proxyRoot = deps.proxyRoot();
    assertExportSourceAllowed(request.sourcePath, proxyRoot, deps.hasReadGrant(request.sourcePath));
    const sourcePath = canonicalizePath(request.sourcePath);
    const info = await fsPromises.lstat(sourcePath);
    if (!canReadProxyFile({ isFile: info.isFile(), isSymbolicLink: info.isSymbolicLink() })) {
      throw new Error('A source video was not found. Re-open it from disk and try again.');
    }

    const fileName = proxyCacheFileName({
      sourcePath,
      size: info.size,
      mtimeMs: info.mtimeMs,
      scale: request.scale,
    });
    const paths = proxyOutputPaths(proxyRoot, fileName);
    const key = `${sourcePath}\0${request.scale}`;
    const running = activeByKey.get(key);
    if (running && !isProxyJobCancelled(running)) {
      return { jobId: running, status: 'started' as const, mediaUrl: null, width: 0, height: 0, fps: 0, durationSec: 0 };
    }

    await fsPromises.mkdir(proxyRoot, { recursive: true });
    const cached = await readCachedSidecar(paths.sidecarPath, paths.finalPath);
    if (cached && cached.scale === request.scale) {
      const mediaUrl = issueTicket(paths.finalPath, proxyRoot);
      return {
        jobId: `cached-${fileName.slice(0, 12)}`,
        status: 'ready' as const,
        mediaUrl,
        width: cached.width,
        height: cached.height,
        fps: cached.fps,
        durationSec: cached.durationSec,
      };
    }

    const jobId = `proxy-${createMediaTicketId()}`;
    activeByKey.set(key, jobId);
    const sender = event.sender;

    void encodeProxy({
      jobId,
      key,
      sender,
      sourcePath,
      scale: request.scale,
      proxyRoot,
      paths,
    });

    return { jobId, status: 'started' as const, mediaUrl: null, width: 0, height: 0, fps: 0, durationSec: 0 };
  });
}

async function readCachedSidecar(sidecarPath: string, finalPath: string): Promise<ProxySidecar | null> {
  try {
    const [raw, stat] = await Promise.all([fsPromises.readFile(sidecarPath, 'utf8'), fsPromises.lstat(finalPath)]);
    if (!canReadProxyFile({ isFile: stat.isFile(), isSymbolicLink: stat.isSymbolicLink() }) || stat.size <= 0) return null;
    return parseProxySidecar(raw);
  } catch {
    return null;
  }
}

async function encodeProxy(options: {
  jobId: string;
  key: string;
  sender: WebContents;
  sourcePath: string;
  scale: PlaybackScale;
  proxyRoot: string;
  paths: { finalPath: string; partialPath: string; sidecarPath: string };
}): Promise<void> {
  const { jobId, key, sender, sourcePath, scale, proxyRoot, paths } = options;
  const base = { jobId, sourcePath, scale };
  try {
    if (isProxyJobCancelled(jobId)) {
      send(sender, { ...base, type: 'cancelled' });
      return;
    }
    const ffmpegPath = await locateFfmpeg();
    const stderr = await probeWithFfmpeg(ffmpegPath, sourcePath, () => isProxyJobCancelled(jobId));
    const probe = parseMediaProbe(stderr);
    if (!probe) {
      send(sender, { ...base, type: 'error', message: 'EditPro could not read the video frame size or frame rate.' });
      return;
    }
    if (isProxyJobCancelled(jobId)) {
      send(sender, { ...base, type: 'cancelled' });
      return;
    }
    const size = proxyDimensions(probe.width, probe.height, scale);
    send(sender, {
      ...base,
      type: 'progress',
      percent: 0,
      width: size.width,
      height: size.height,
      fps: probe.fps,
      durationSec: probe.durationSec,
    });
    const result = await runProxyEncode({
      jobId,
      ffmpegPath,
      inputPath: sourcePath,
      partialPath: paths.partialPath,
      finalPath: paths.finalPath,
      width: size.width,
      height: size.height,
      fps: probe.fps,
      durationSec: probe.durationSec,
      onProgress: (update) => {
        send(sender, { ...base, type: 'progress', percent: update.percent, fps: probe.fps, durationSec: probe.durationSec, width: size.width, height: size.height });
      },
    });
    if (result.status === 'cancelled') {
      send(sender, { ...base, type: 'cancelled' });
      return;
    }
    if (result.status === 'error') {
      send(sender, { ...base, type: 'error', message: result.message });
      return;
    }
    const sidecar: ProxySidecar = {
      version: PROXY_FORMAT_VERSION,
      sourcePath,
      scale,
      width: size.width,
      height: size.height,
      fps: probe.fps,
      durationSec: probe.durationSec,
      videoCodec: probe.videoCodec,
    };
    await fsPromises.writeFile(paths.sidecarPath, serializeProxySidecar(sidecar), 'utf8');
    const mediaUrl = issueTicket(paths.finalPath, proxyRoot);
    send(sender, {
      ...base,
      type: 'done',
      percent: 100,
      mediaUrl,
      width: size.width,
      height: size.height,
      fps: probe.fps,
      durationSec: probe.durationSec,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Proxy generation failed. Playback will keep using the original.';
    send(sender, { ...base, type: 'error', message });
  } finally {
    if (activeByKey.get(key) === jobId) activeByKey.delete(key);
    acknowledgeProxyCancel(jobId);
  }
}
