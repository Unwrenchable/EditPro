/**
 * Native file picker and share sheet for the Capacitor shell.
 * The browser build keeps the in-page picker; these helpers run only when
 * the host kind is capacitor.
 */

const EXTENSION_TYPES: Record<string, string> = {
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.editpro': 'application/json',
  '.json': 'application/json',
};

export interface PickedNativeFile {
  name: string;
  mimeType: string;
  blob?: Blob;
  webPath?: string;
  path?: string;
}

/** Turn an `<input accept>` list into media types the system picker understands. */
export function pickerTypes(accept: string): string[] {
  const types = new Set<string>();
  let sawExtension = false;
  for (const raw of accept.split(',')) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;
    if (token.startsWith('.')) {
      sawExtension = true;
      const mapped = EXTENSION_TYPES[token];
      if (mapped) types.add(mapped);
      continue;
    }
    types.add(token);
  }
  if (sawExtension) types.add('application/octet-stream');
  return [...types];
}

export function isNativeCancel(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /cancel|dismiss/i.test(error.message);
}

export async function fileFromPicked(
  entry: PickedNativeFile,
  readUrl: (url: string) => Promise<Blob>,
  convertPath: (path: string) => string,
): Promise<File | null> {
  let blob = entry.blob;
  if (!blob) {
    const url = entry.webPath || (entry.path ? convertPath(entry.path) : '');
    if (!url) return null;
    blob = await readUrl(url);
  }
  const type = entry.mimeType || blob.type || 'application/octet-stream';
  return new File([blob], entry.name || 'media', { type });
}

export async function pickCapacitorFiles(accept: string, multiple: boolean): Promise<File[] | null> {
  const [{ FilePicker }, { Capacitor }] = await Promise.all([
    import('@capawesome/capacitor-file-picker'),
    import('@capacitor/core'),
  ]);
  try {
    const result = await FilePicker.pickFiles({
      types: pickerTypes(accept),
      limit: multiple ? 0 : 1,
    });
    const files: File[] = [];
    for (const entry of result.files) {
      const file = await fileFromPicked(
        entry,
        async (url) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Could not read ${entry.name}`);
          return response.blob();
        },
        (path) => Capacitor.convertFileSrc(path),
      );
      if (file) files.push(file);
    }
    return files.length > 0 ? files : null;
  } catch (error) {
    if (isNativeCancel(error)) return null;
    throw error;
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file to share'));
    reader.readAsDataURL(blob);
  });
  const comma = data.indexOf(',');
  return comma >= 0 ? data.slice(comma + 1) : data;
}

export async function shareCapacitorFile(file: Blob, filename: string, title?: string): Promise<boolean> {
  const [{ Directory, Filesystem }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const safe = filename.replace(/[^\w.-]+/g, '_') || 'editpro-export';
  try {
    await Filesystem.writeFile({
      path: safe,
      data: await blobToBase64(file),
      directory: Directory.Cache,
    });
    const uri = await Filesystem.getUri({ path: safe, directory: Directory.Cache });
    await Share.share({
      title: title ?? safe,
      dialogTitle: title ?? 'Share',
      files: [uri.uri],
    });
    return true;
  } catch (error) {
    if (isNativeCancel(error)) return false;
    throw error;
  }
}
