import { useCallback, useEffect, useRef, useState } from 'react';
import { getPlatform } from '../platform';
import type { PlaybackScale, ProxyPlaybackEvent } from '../types/electron';

export type ProxyStatus = 'idle' | 'unavailable' | 'running' | 'ready' | 'error' | 'cancelled';

export interface ProxyMediaState {
  useProxy: boolean;
  resolution: PlaybackScale;
  proxyUrl: string | null;
  status: ProxyStatus;
  percent: number;
  message: string | null;
  fps: number | null;
  width: number;
  height: number;
  decodeLabel: string;
  /** Why auto proxy chose this resolution, when the desktop app classified the file. */
  advice: string | null;
  toggleProxy: () => void;
  setResolution: (scale: PlaybackScale) => void;
  cancel: () => void;
}

interface ProxyJob {
  proxyUrl: string | null;
  proxyForPath: string | null;
  proxyScale: PlaybackScale | null;
  status: ProxyStatus;
  percent: number;
  message: string | null;
  fps: number | null;
  width: number;
  height: number;
}

const EMPTY: ProxyJob = {
  proxyUrl: null,
  proxyForPath: null,
  proxyScale: null,
  status: 'idle',
  percent: 0,
  message: null,
  fps: null,
  width: 0,
  height: 0,
};

/**
 * Ask the main process for a proxy of the granted original.
 * The original path is never replaced. Browser sessions, which have no disk
 * grant, keep playing the blob the user opened.
 */
export function useProxyMedia(sourcePath: string | null): ProxyMediaState {
  const [useProxy, setUseProxy] = useState(true);
  const [resolution, setResolutionState] = useState<PlaybackScale>('full');
  const [job, setJob] = useState<ProxyJob>(EMPTY);
  const [decodeLabel, setDecodeLabel] = useState('Hardware decode unavailable');
  const [advice, setAdvice] = useState<string | null>(null);
  const [adviceFor, setAdviceFor] = useState<string | null>(null);
  const userScale = useRef(false);
  if (adviceFor !== sourcePath) {
    setAdviceFor(sourcePath);
    setAdvice(null);
  }

  useEffect(() => {
    const bridge = getPlatform();
    let cancelled = false;
    void bridge.getDecodeInfo().then((info) => {
      if (!cancelled) setDecodeLabel(info.label);
    }).catch(() => {
      if (!cancelled) setDecodeLabel('Hardware decode unavailable');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const nativeProxy = getPlatform().capabilities.nativeProxy;
  const canStart = Boolean(sourcePath && useProxy && nativeProxy);
  const requestKey = canStart && sourcePath ? `${sourcePath}|${resolution}` : '';
  const [trackedKey, setTrackedKey] = useState<string | null>(null);
  if (trackedKey !== requestKey) {
    setTrackedKey(requestKey);
    if (canStart && sourcePath) {
      setJob((prev) => {
        const same = prev.proxyUrl !== null && prev.proxyForPath === sourcePath && prev.proxyScale === resolution;
        return {
          ...prev,
          status: same ? 'ready' : 'running',
          percent: same ? 100 : 0,
          message: null,
          proxyUrl: same ? prev.proxyUrl : null,
        };
      });
    }
  }

  useEffect(() => {
    if (!canStart || !sourcePath) return;
    const bridge = getPlatform();

    let disposed = false;
    let activeJobId: string | null = null;
    const onEvent = (event: ProxyPlaybackEvent) => {
      if (disposed || event.sourcePath !== sourcePath || event.scale !== resolution) return;
      if (activeJobId && event.jobId !== activeJobId) return;
      if (event.fps && event.fps > 0) {
        setJob((prev) => ({
          ...prev,
          fps: event.fps ?? prev.fps,
          width: event.width || prev.width,
          height: event.height || prev.height,
        }));
      }
      if (event.type === 'progress') {
        setJob((prev) => ({
          ...prev,
          status: 'running',
          percent: event.percent ?? prev.percent,
          message: null,
        }));
        return;
      }
      if (event.type === 'done' && event.mediaUrl) {
        setJob((prev) => ({
          ...prev,
          status: 'ready',
          percent: 100,
          proxyUrl: event.mediaUrl ?? prev.proxyUrl,
          proxyForPath: sourcePath,
          proxyScale: resolution,
          fps: event.fps && event.fps > 0 ? event.fps : prev.fps,
          width: event.width || prev.width,
          height: event.height || prev.height,
          message: null,
        }));
        return;
      }
      if (event.type === 'cancelled') {
        setJob((prev) => ({ ...prev, status: 'cancelled', message: null }));
        return;
      }
      if (event.type === 'error') {
        setJob((prev) => ({
          ...prev,
          status: 'error',
          proxyUrl: null,
          message: event.message ?? 'Proxy generation failed. Playback will keep using the original.',
        }));
      }
    };

    const unsubscribe = bridge.onProxyEvent(onEvent);
    void bridge.startProxy({ sourcePath, scale: resolution }).then((result) => {
      if (disposed) {
        if (result.jobId.startsWith('proxy-')) void bridge.cancelProxy(result.jobId);
        return;
      }
      activeJobId = result.jobId;
      if (result.status === 'ready' && result.mediaUrl) {
        setJob({
          proxyUrl: result.mediaUrl,
          proxyForPath: sourcePath,
          proxyScale: resolution,
          status: 'ready',
          percent: 100,
          message: null,
          fps: result.fps > 0 ? result.fps : null,
          width: result.width,
          height: result.height,
        });
      }
    }).catch((error: unknown) => {
      if (disposed) return;
      const message = error instanceof Error ? error.message : 'Proxy generation failed. Playback will keep using the original.';
      setJob((prev) => ({ ...prev, status: 'error', proxyUrl: null, message }));
    });

    return () => {
      disposed = true;
      unsubscribe();
      if (activeJobId?.startsWith('proxy-')) void bridge.cancelProxy(activeJobId);
    };
  }, [canStart, sourcePath, resolution]);

  useEffect(() => {
    userScale.current = false;
    const host = getPlatform();
    if (!sourcePath || !host.capabilities.nativeProxy) return;
    let cancelled = false;
    void host.classifyProxy(sourcePath).then((decision) => {
      if (cancelled) return;
      setAdvice(decision.reason);
      if (decision.required && !userScale.current) setResolutionState(decision.scale);
    }).catch(() => {
      if (!cancelled) setAdvice(null);
    });
    return () => {
      cancelled = true;
    };
  }, [sourcePath]);

  const toggleProxy = useCallback(() => {
    setUseProxy((value) => !value);
  }, []);

  const setResolution = useCallback((scale: PlaybackScale) => {
    userScale.current = true;
    setResolutionState(scale);
  }, []);

  const cancel = useCallback(() => {
    setUseProxy(false);
  }, []);

  const proxyUrl = job.proxyForPath === sourcePath && job.proxyScale === resolution ? job.proxyUrl : null;
  let status = job.status;
  if (!useProxy) status = proxyUrl ? 'ready' : 'idle';
  else if (!sourcePath) status = 'idle';
  else if (!nativeProxy) status = 'unavailable';

  return {
    useProxy,
    resolution,
    proxyUrl,
    status,
    percent: job.percent,
    message: job.message,
    fps: job.fps,
    width: job.width,
    height: job.height,
    decodeLabel,
    advice,
    toggleProxy,
    setResolution,
    cancel,
  };
}
