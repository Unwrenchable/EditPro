import type { EditorMode } from '../types';
import {
  createDefaultPhotoEdits,
  createDefaultVideoEdits,
  normalizePhotoEdits,
  normalizeTimelineZoom,
  normalizeVideoEdits,
  type PhotoEditSnapshot,
  type VideoEditSnapshot,
} from './editSnapshots';

/** Current on-disk project schema. Older readers must reject newer versions. */
export const PROJECT_FORMAT = 'editpro' as const;
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = '.editpro';

export interface ProjectMediaRef {
  id: string;
  kind: 'image' | 'video';
  name: string;
  /** Absolute path when the file was opened from disk. Empty when the path is unknown. */
  path: string;
  /** Path relative to the project file, when both locations are known. */
  relativePath: string | null;
}

export interface EditProProject {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  generator: 'EditPro';
  savedAt: string;
  mode: EditorMode;
  media: ProjectMediaRef[];
  photo: {
    mediaId: string | null;
    edits: PhotoEditSnapshot;
  };
  video: {
    mediaId: string | null;
    edits: VideoEditSnapshot;
    timelineZoom: number;
  };
}

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

export interface ProjectSource {
  mode: EditorMode;
  projectPath: string | null;
  savedAt?: string;
  photo: {
    edits: PhotoEditSnapshot;
    mediaPath: string | null;
    mediaName: string | null;
  };
  video: {
    edits: VideoEditSnapshot;
    mediaPath: string | null;
    mediaName: string | null;
    timelineZoom: number;
  };
}

const MODES: readonly EditorMode[] = ['photo', 'video', 'magic'];

function splitPath(filePath: string): string[] {
  return filePath.split(/[/\\]/).filter((part) => part.length > 0);
}

export function fileNameFromPath(filePath: string): string {
  const parts = splitPath(filePath);
  return parts[parts.length - 1] ?? filePath;
}

export function ensureProjectExtension(name: string): string {
  return name.toLowerCase().endsWith(PROJECT_EXTENSION) ? name : `${name}${PROJECT_EXTENSION}`;
}

export function defaultProjectFileName(mediaName: string | null): string {
  if (!mediaName) return `Untitled${PROJECT_EXTENSION}`;
  const base = mediaName.replace(/\.[^.]+$/, '') || 'Untitled';
  return ensureProjectExtension(base);
}

/** Relative path from the project file's directory to a media file, using `/` separators. */
export function toRelativePath(projectFilePath: string, mediaPath: string): string | null {
  if (!projectFilePath || !mediaPath) return null;
  const projectParts = splitPath(projectFilePath);
  const mediaParts = splitPath(mediaPath);
  if (projectParts.length < 2 || mediaParts.length === 0) return null;

  const projectDrive = projectParts[0]?.includes(':') ? projectParts[0].toLowerCase() : null;
  const mediaDrive = mediaParts[0]?.includes(':') ? mediaParts[0].toLowerCase() : null;
  if (projectDrive !== mediaDrive) return null;

  projectParts.pop();
  let index = 0;
  while (
    index < projectParts.length &&
    index < mediaParts.length &&
    projectParts[index].toLowerCase() === mediaParts[index].toLowerCase()
  ) {
    index += 1;
  }
  const up = new Array(projectParts.length - index).fill('..');
  const relative = [...up, ...mediaParts.slice(index)].join('/');
  return relative || null;
}

export function resolveRelativePath(projectFilePath: string, relativePath: string): string {
  const projectParts = splitPath(projectFilePath);
  projectParts.pop();
  const stack = [...projectParts];
  for (const part of relativePath.split(/[/\\]/)) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  const windows = /^[a-zA-Z]:/.test(stack[0] ?? '') || projectFilePath.includes('\\');
  if (windows) return stack.join('\\');
  return projectFilePath.startsWith('/') ? `/${stack.join('/')}` : stack.join('/');
}

export function candidateMediaPaths(ref: ProjectMediaRef, projectPath: string | null): string[] {
  const paths: string[] = [];
  if (ref.path) paths.push(ref.path);
  if (ref.relativePath && projectPath) {
    const resolved = resolveRelativePath(projectPath, ref.relativePath);
    if (!paths.includes(resolved)) paths.push(resolved);
  }
  return paths;
}

function mediaRef(
  id: string,
  kind: 'image' | 'video',
  name: string | null,
  mediaPath: string | null,
  projectPath: string | null,
): ProjectMediaRef {
  const path = mediaPath ?? '';
  return {
    id,
    kind,
    name: name || (path ? fileNameFromPath(path) : kind),
    path,
    relativePath: path && projectPath ? toRelativePath(projectPath, path) : null,
  };
}

export function createProject(source: ProjectSource): EditProProject {
  const media: ProjectMediaRef[] = [];
  let photoMediaId: string | null = null;
  let videoMediaId: string | null = null;

  if (source.photo.mediaPath || source.photo.mediaName) {
    photoMediaId = 'photo';
    media.push(mediaRef('photo', 'image', source.photo.mediaName, source.photo.mediaPath, source.projectPath));
  }
  if (source.video.mediaPath || source.video.mediaName) {
    videoMediaId = 'video';
    media.push(mediaRef('video', 'video', source.video.mediaName, source.video.mediaPath, source.projectPath));
  }

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    generator: 'EditPro',
    savedAt: source.savedAt ?? new Date().toISOString(),
    mode: source.mode,
    media,
    photo: { mediaId: photoMediaId, edits: source.photo.edits },
    video: {
      mediaId: videoMediaId,
      edits: source.video.edits,
      timelineZoom: normalizeTimelineZoom(source.video.timelineZoom),
    },
  };
}

export function serializeProject(project: EditProProject): string {
  return JSON.stringify(project, null, 2);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function normalizeMedia(value: unknown): ProjectMediaRef[] {
  if (!Array.isArray(value)) return [];
  const refs: ProjectMediaRef[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record || typeof record.id !== 'string' || !record.id) continue;
    const kind = record.kind === 'video' ? 'video' : record.kind === 'image' ? 'image' : null;
    if (!kind) continue;
    refs.push({
      id: record.id,
      kind,
      name: typeof record.name === 'string' && record.name ? record.name : kind,
      path: typeof record.path === 'string' ? record.path : '',
      relativePath: typeof record.relativePath === 'string' ? record.relativePath : null,
    });
  }
  return refs;
}

/** Parse and normalize an EditPro project. Throws ProjectFileError on an incompatible file. */
export function parseProject(json: string): EditProProject {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ProjectFileError('This file is not valid JSON.');
  }

  const record = asRecord(raw);
  if (!record) throw new ProjectFileError('This file is not an EditPro project.');
  if (record.format !== PROJECT_FORMAT) {
    throw new ProjectFileError('This file is not an EditPro project.');
  }
  if (record.version !== PROJECT_VERSION) {
    throw new ProjectFileError(
      `This project uses format version ${String(record.version)}, and this version of EditPro reads version ${PROJECT_VERSION}.`,
    );
  }

  const mode = MODES.includes(record.mode as EditorMode) ? (record.mode as EditorMode) : 'photo';
  const savedAt = typeof record.savedAt === 'string' && record.savedAt ? record.savedAt : new Date(0).toISOString();
  const photo = asRecord(record.photo);
  const video = asRecord(record.video);

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    generator: 'EditPro',
    savedAt,
    mode,
    media: normalizeMedia(record.media),
    photo: {
      mediaId: photo && typeof photo.mediaId === 'string' ? photo.mediaId : null,
      edits: normalizePhotoEdits(photo?.edits ?? createDefaultPhotoEdits()),
    },
    video: {
      mediaId: video && typeof video.mediaId === 'string' ? video.mediaId : null,
      edits: normalizeVideoEdits(video?.edits ?? createDefaultVideoEdits()),
      timelineZoom: normalizeTimelineZoom(video?.timelineZoom),
    },
  };
}
