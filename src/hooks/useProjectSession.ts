import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorMode } from '../types';
import type { PhotoEditorApi } from './usePhotoEditor';
import type { VideoEditorApi } from './useVideoEditor';
import { createProjectIO, type ProjectIO } from '../services/projectIO';
import type { MediaBinding } from '../utils/editSnapshots';
import { isTextEditingTarget, matchEditorShortcut } from '../utils/editorShortcuts';
import { fileFromDataUrl, fileMediaPath } from '../utils/mediaFiles';
import {
  candidateMediaPaths,
  createProject,
  defaultProjectFileName,
  fileNameFromPath,
  parseProject,
  ProjectFileError,
  serializeProject,
  type ProjectMediaRef,
} from '../utils/projectFile';
import type { RecentFileEntry } from '../utils/recentFiles';
import type { RecoveryOffer } from '../utils/sessionStore';

const AUTOSAVE_DELAY_MS = 800;

interface UseProjectSessionOptions {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  photo: PhotoEditorApi;
  video: VideoEditorApi;
}

function errorMessage(error: unknown): string {
  if (error instanceof ProjectFileError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong while accessing the project.';
}

async function loadBinding(io: ProjectIO, ref: ProjectMediaRef, projectPath: string | null): Promise<MediaBinding> {
  const name = ref.name || 'media';
  for (const path of candidateMediaPaths(ref, projectPath)) {
    try {
      const dataUrl = await io.readMediaDataUrl(path);
      const file = await fileFromDataUrl(dataUrl, name);
      return {
        file,
        url: URL.createObjectURL(file),
        path,
        name: file.name,
        missing: false,
      };
    } catch {
      // Try the next candidate (absolute path, then path relative to the project).
    }
  }
  return {
    file: null,
    url: null,
    path: ref.path || null,
    name: ref.name || null,
    missing: true,
  };
}

export function useProjectSession({ mode, onModeChange, photo, video }: UseProjectSessionOptions) {
  const ioRef = useRef<ProjectIO | null>(null);
  if (!ioRef.current) ioRef.current = createProjectIO();
  const io = ioRef.current;

  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [baseline, setBaseline] = useState({ photo: photo.revision, video: video.revision });
  const [recent, setRecent] = useState<RecentFileEntry[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryOffer | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const pendingClean = useRef(false);

  if (pendingClean.current) {
    pendingClean.current = false;
    if (baseline.photo !== photo.revision || baseline.video !== video.revision) {
      setBaseline({ photo: photo.revision, video: video.revision });
    }
  }

  const dirty = photo.revision !== baseline.photo || video.revision !== baseline.video;

  const modeRef = useRef(mode);
  const pathRef = useRef(projectPath);
  const dirtyRef = useRef(dirty);
  const photoRef = useRef(photo);
  const videoRef = useRef(video);

  modeRef.current = mode;
  pathRef.current = projectPath;
  dirtyRef.current = dirty;
  photoRef.current = photo;
  videoRef.current = video;

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  const projectName = projectPath ? fileNameFromPath(projectPath) : 'Untitled';

  const serializeCurrent = useCallback((path: string | null, savedAt?: string) => {
    const photoApi = photoRef.current;
    const videoApi = videoRef.current;
    return serializeProject(
      createProject({
        mode: modeRef.current,
        projectPath: path,
        savedAt,
        photo: {
          edits: photoApi.getEdits(),
          mediaPath: photoApi.state.mediaPath,
          mediaName: photoApi.state.mediaName,
        },
        video: {
          edits: videoApi.getEdits(),
          mediaPath: videoApi.state.mediaPath,
          mediaName: videoApi.state.mediaName,
          timelineZoom: videoApi.state.timelineZoom,
        },
      }),
    );
  }, []);

  const flushAutosave = useCallback(
    (sync: boolean) => {
      try {
        const json = serializeCurrent(pathRef.current);
        if (sync) io.flushAutosave(json, pathRef.current);
        else void io.autosave(json, pathRef.current).catch(() => setStatusMessage('Autosave failed'));
      } catch {
        setStatusMessage('Autosave failed');
      }
    },
    [io, serializeCurrent],
  );

  useEffect(() => {
    if (!sessionReady || recovery || !dirty) return;
    const timeout = window.setTimeout(() => flushAutosave(false), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [dirty, photo.revision, video.revision, sessionReady, recovery, flushAutosave]);

  const applyContents = useCallback(
    async (contents: string, path: string | null, options: { dirty: boolean; remember: boolean }) => {
      const project = parseProject(contents);
      const photoRefMedia = project.media.find((item) => item.id === project.photo.mediaId) ?? null;
      const videoRefMedia = project.media.find((item) => item.id === project.video.mediaId) ?? null;
      const [photoBinding, videoBinding] = await Promise.all([
        photoRefMedia ? loadBinding(io, photoRefMedia, path) : Promise.resolve(null),
        videoRefMedia ? loadBinding(io, videoRefMedia, path) : Promise.resolve(null),
      ]);
      if (!options.dirty) pendingClean.current = true;
      photoRef.current.restore(project.photo.edits, photoBinding);
      videoRef.current.restore(project.video.edits, videoBinding, project.video.timelineZoom);
      setProjectPath(path);
      onModeChange(project.mode);
      if (!options.dirty && path) await io.noteSaved(path);
      if (options.remember && path) {
        const entry: RecentFileEntry = {
          path,
          name: fileNameFromPath(path),
          mode: project.mode,
          openedAt: new Date().toISOString(),
          contents,
        };
        setRecent(await io.rememberRecent(entry));
      }
      const missing = Boolean(photoBinding?.missing || videoBinding?.missing);
      if (missing) setStatusMessage('Some media files could not be found. Relink them to preview.');
      else if (options.dirty) setStatusMessage('Restored autosaved project');
      else setStatusMessage(`Opened ${fileNameFromPath(path ?? 'project')}`);
    },
    [io, onModeChange],
  );

  const confirmDiscard = useCallback(() => {
    if (!dirtyRef.current) return true;
    return window.confirm('This project has unsaved changes. Continue without saving?');
  }, []);

  const persist = useCallback(
    async (path: string) => {
      const json = serializeCurrent(path, new Date().toISOString());
      await io.writeProject(path, json);
      setProjectPath(path);
      setBaseline({
        photo: photoRef.current.revision,
        video: videoRef.current.revision,
      });
      await io.noteSaved(path);
      const entry: RecentFileEntry = {
        path,
        name: fileNameFromPath(path),
        mode: modeRef.current,
        openedAt: new Date().toISOString(),
        contents: json,
      };
      setRecent(await io.rememberRecent(entry));
      setStatusMessage(`Saved ${entry.name}`);
    },
    [io, serializeCurrent],
  );

  const saveAs = useCallback(async () => {
    try {
      const suggested =
        (pathRef.current && fileNameFromPath(pathRef.current)) ||
        defaultProjectFileName(photoRef.current.state.mediaName ?? videoRef.current.state.mediaName);
      const path = await io.pickSavePath(suggested);
      if (!path) return;
      await persist(path);
    } catch (error) {
      setStatusMessage(errorMessage(error));
    }
  }, [io, persist]);

  const save = useCallback(async () => {
    if (!pathRef.current) {
      await saveAs();
      return;
    }
    try {
      await persist(pathRef.current);
    } catch (error) {
      setStatusMessage(errorMessage(error));
    }
  }, [persist, saveAs]);

  const openProject = useCallback(async () => {
    if (!confirmDiscard()) return;
    try {
      const opened = await io.openProject();
      if (!opened) return;
      await applyContents(opened.contents, opened.path, { dirty: false, remember: true });
    } catch (error) {
      setStatusMessage(errorMessage(error));
    }
  }, [applyContents, confirmDiscard, io]);

  const openRecent = useCallback(
    async (path: string) => {
      if (!confirmDiscard()) return;
      try {
        const contents = await io.readProject(path);
        await applyContents(contents, path, { dirty: false, remember: true });
      } catch (error) {
        setStatusMessage(errorMessage(error));
      }
    },
    [applyContents, confirmDiscard, io],
  );

  const restoreRecovery = useCallback(async () => {
    if (!recovery) return;
    try {
      await applyContents(recovery.autosave, recovery.projectPath, { dirty: true, remember: false });
      setRecovery(null);
    } catch (error) {
      setStatusMessage(errorMessage(error));
    }
  }, [applyContents, recovery]);

  const discardRecovery = useCallback(async () => {
    try {
      await io.discardRecovery();
    } catch {
      setStatusMessage('Could not discard the autosave.');
    }
    pendingClean.current = true;
    setRecovery(null);
  }, [io]);

  const importMedia = useCallback(
    async (kind: 'image' | 'video') => {
      try {
        const picked = await io.pickMedia(kind);
        if (!picked) return;
        if (kind === 'image') {
          onModeChange('photo');
          photoRef.current.loadImage(picked.file, picked.path ?? fileMediaPath(picked.file));
        } else {
          onModeChange('video');
          videoRef.current.loadVideo(picked.file, picked.path ?? fileMediaPath(picked.file));
        }
      } catch (error) {
        setStatusMessage(errorMessage(error));
      }
    },
    [io, onModeChange],
  );

  const relink = useCallback(
    async (kind: 'image' | 'video') => {
      try {
        const picked = await io.pickMedia(kind);
        if (!picked) return;
        const binding: MediaBinding = {
          file: picked.file,
          url: URL.createObjectURL(picked.file),
          path: picked.path ?? fileMediaPath(picked.file),
          name: picked.file.name,
          missing: false,
        };
        if (kind === 'image') photoRef.current.setMedia(binding);
        else videoRef.current.setMedia(binding);
        setStatusMessage(`Relinked ${picked.file.name}`);
      } catch (error) {
        setStatusMessage(errorMessage(error));
      }
    },
    [io],
  );

  const undo = useCallback(() => {
    if (modeRef.current === 'photo') photoRef.current.undo();
    else videoRef.current.undo();
  }, []);

  const redo = useCallback(() => {
    if (modeRef.current === 'photo') photoRef.current.redo();
    else videoRef.current.redo();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [offer, list] = await Promise.all([io.boot(), io.listRecent()]);
        if (cancelled) return;
        setRecent(list);
        setRecovery(offer);
      } catch {
        if (!cancelled) setStatusMessage('Could not read the previous session.');
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [io]);

  useEffect(() => {
    const onLeave = () => {
      if (dirtyRef.current) flushAutosave(true);
      void io.markCleanShutdown();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [flushAutosave, io]);

  useEffect(() => {
    const bridge = window.editpro;
    if (bridge?.onMenu) {
      const undoFromMenu = () => {
        if (isTextEditingTarget(document.activeElement)) {
          document.execCommand('undo');
          return;
        }
        undo();
      };
      const redoFromMenu = () => {
        if (isTextEditingTarget(document.activeElement)) {
          document.execCommand('redo');
          return;
        }
        redo();
      };
      const offs = [
        bridge.onMenu('menu:undo', undoFromMenu),
        bridge.onMenu('menu:redo', redoFromMenu),
        bridge.onMenu('menu:save', () => void save()),
        bridge.onMenu('menu:saveAs', () => void saveAs()),
        bridge.onMenu('menu:openProject', () => void openProject()),
        bridge.onMenu('menu:openImage', () => void importMedia('image')),
        bridge.onMenu('menu:openVideo', () => void importMedia('video')),
      ];
      return () => offs.forEach((off) => off());
    }

    const onKey = (event: KeyboardEvent) => {
      const command = matchEditorShortcut(event);
      if (!command) return;
      event.preventDefault();
      if (command === 'undo') undo();
      else if (command === 'redo') redo();
      else if (command === 'save') void save();
      else if (command === 'saveAs') void saveAs();
      else void openProject();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [importMedia, io, openProject, redo, save, saveAs, undo]);

  const canUndo = mode === 'photo' ? photo.canUndo : video.canUndo;
  const canRedo = mode === 'photo' ? photo.canRedo : video.canRedo;

  return {
    projectPath,
    projectName,
    dirty,
    recent,
    statusMessage,
    recovery,
    canUndo,
    canRedo,
    undo,
    redo,
    save,
    saveAs,
    openProject,
    openRecent,
    restoreRecovery,
    discardRecovery,
    relinkPhoto: () => void relink('image'),
    relinkVideo: () => void relink('video'),
  };
}

export type ProjectSessionApi = ReturnType<typeof useProjectSession>;
