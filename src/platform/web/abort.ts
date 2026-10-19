export function abortError(): Error {
  const error = new Error('Export cancelled.');
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
