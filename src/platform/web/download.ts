export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function replaceExtension(name: string, extension: string): string {
  const dot = extension.startsWith('.') ? extension : `.${extension}`;
  const base = name.replace(/\.[a-z0-9]{1,8}$/i, '');
  return `${base || 'editpro'}${dot}`;
}

export function extensionForMime(mime: string): string {
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('quicktime')) return '.mov';
  if (mime.includes('png')) return '.png';
  return '.mp4';
}
