/**
 * One offline AI task at a time. Cancel aborts the child processes it spawned.
 */
import type { IpcMainInvokeEvent } from 'electron';
import type { AiEvent, AiHost } from './host.js';

interface ActiveJob {
  id: string;
  controller: AbortController;
}

let active: ActiveJob | null = null;

export function startAiJob(): { id: string; signal: AbortSignal } {
  if (active) {
    throw new Error('An AI task is already running. Cancel it before starting another.');
  }
  const id = `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  active = { id, controller };
  return { id, signal: controller.signal };
}

export function cancelAiJob(id: string): boolean {
  if (!active || active.id !== id) return false;
  active.controller.abort();
  return true;
}

export function finishAiJob(id: string): void {
  if (active?.id === id) active = null;
}

export function cancelAllAiJobs(): void {
  active?.controller.abort();
  active = null;
}

export async function withAiJob<T>(
  host: AiHost,
  event: IpcMainInvokeEvent,
  work: (ctx: {
    id: string;
    signal: AbortSignal;
    progress: (percent: number, message: string) => void;
  }) => Promise<T>,
): Promise<T> {
  const job = startAiJob();
  const progress = (percent: number, message: string) => {
    const payload: AiEvent = {
      jobId: job.id,
      type: 'progress',
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      message,
    };
    host.send(event, payload);
  };
  progress(0, 'Starting');
  try {
    const value = await work({ id: job.id, signal: job.signal, progress });
    host.send(event, { jobId: job.id, type: 'done', percent: 100 });
    return value;
  } catch (error) {
    const cancelled = job.signal.aborted || (error instanceof Error && error.message === 'Cancelled');
    const message = error instanceof Error && error.message ? error.message : 'The AI task failed';
    host.send(event, {
      jobId: job.id,
      type: cancelled ? 'cancelled' : 'error',
      message: cancelled ? 'Cancelled' : message,
    });
    if (cancelled) throw new Error('Cancelled');
    throw error instanceof Error ? error : new Error(message);
  } finally {
    finishAiJob(job.id);
  }
}
