import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditProBridge } from '../../../types/electron';

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The AI task failed';
}

function isCancel(message: string): boolean {
  return message === 'Cancelled' || message.endsWith(': Cancelled');
}

export function useAiTask() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobId = useRef<string | null>(null);

  useEffect(() => {
    const bridge = window.editpro;
    if (!bridge) return undefined;
    return bridge.onAiEvent((event) => {
      jobId.current = event.jobId;
      if (event.type === 'progress' && event.message) setProgress(event.message);
    });
  }, []);

  const run = useCallback(async <T,>(work: (bridge: EditProBridge) => Promise<T>): Promise<T | null> => {
    const bridge = window.editpro;
    if (!bridge?.aiStatus) {
      setError('Open the EditPro desktop app to use offline AI.');
      return null;
    }
    setError(null);
    setProgress('Starting');
    setBusy(true);
    try {
      return await work(bridge);
    } catch (err) {
      const message = errorText(err);
      if (!isCancel(message)) setError(message);
      return null;
    } finally {
      setBusy(false);
      setProgress(null);
      jobId.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    const id = jobId.current;
    if (id) void window.editpro?.aiCancel(id);
  }, []);

  return { busy, progress, error, setError, run, cancel };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const whole = Math.floor(safe);
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  const frac = Math.floor((safe - whole) * 10);
  return `${minutes}:${secs.toString().padStart(2, '0')}.${frac}`;
}
