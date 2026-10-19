/**
 * Media paths in FCPXML and xmeml.
 * POSIX files use `file:///films/a.mov`. Windows files use `file://localhost/C:/films/a.mov`.
 */

function encodeSegments(filePath: string): string {
  return filePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function decodePath(value: string): string {
  return value.replace(/%[0-9A-Fa-f]{2}/g, (token) => {
    try {
      return decodeURIComponent(token);
    } catch {
      return token;
    }
  });
}

export function pathToFileUrl(filePath: string): string {
  const normalized = filePath.trim().replace(/\\/g, '/');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) return normalized;
  const drive = /^[A-Za-z]:\//.exec(normalized);
  if (drive) {
    const rest = normalized.slice(drive[0].length);
    return `file://localhost/${drive[0]}${encodeSegments(rest)}`;
  }
  const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${encodeSegments(absolute)}`;
}

export function fileUrlToPath(value: string): string {
  const trimmed = value.trim();
  if (!/^file:/i.test(trimmed)) return trimmed.replace(/\\/g, '/');
  let rest = trimmed.replace(/^file:\/\//i, '');
  rest = rest.replace(/^localhost\//i, '');
  rest = decodePath(rest).replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(rest)) return rest;
  if (!rest.startsWith('/')) rest = `/${rest}`;
  return rest;
}

export function mediaBaseName(filePath: string): string {
  const normalized = fileUrlToPath(filePath);
  const base = normalized.split('/').pop() ?? normalized;
  return base || 'clip';
}

export function mediaStem(filePath: string): string {
  const base = mediaBaseName(filePath);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}
