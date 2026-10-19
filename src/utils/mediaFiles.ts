/** Electron's File objects carry the native path. Browsers do not. */
export function fileMediaPath(file: File): string | null {
  const path = (file as File & { path?: unknown }).path;
  return typeof path === 'string' && path.length > 0 ? path : null;
}

export function revokeIfBlob(url: string | null | undefined): void {
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
}

export async function fileFromDataUrl(dataUrl: string, name: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}
