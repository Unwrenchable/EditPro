import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoAdjustments, PhotoEditorState, PhotoFilterName, ExportOptions } from '../types';
import {
  createDefaultPhotoEdits,
  type MediaBinding,
  type PhotoEditSnapshot,
} from '../utils/editSnapshots';
import { commit, createHistory, redo as redoHistory, undo as undoHistory, type HistoryState } from '../utils/history';
import { buildCSSFilter, buildTransform, exportImage, DEFAULT_ADJUSTMENTS } from '../utils/imageFilters';
import { fileMediaPath, revokeIfBlob } from '../utils/mediaFiles';

interface PhotoModel {
  file: File | null;
  imageUrl: string | null;
  mediaPath: string | null;
  mediaName: string | null;
  mediaMissing: boolean;
  isCropping: boolean;
  history: HistoryState<PhotoEditSnapshot>;
  revision: number;
}

function createPhotoModel(): PhotoModel {
  return {
    file: null,
    imageUrl: null,
    mediaPath: null,
    mediaName: null,
    mediaMissing: false,
    isCropping: false,
    history: createHistory(createDefaultPhotoEdits()),
    revision: 0,
  };
}

function commitPhoto(
  model: PhotoModel,
  mutate: (snap: PhotoEditSnapshot) => PhotoEditSnapshot,
  coalesceKey?: string,
): PhotoModel {
  const next = mutate(structuredClone(model.history.present));
  const history = commit(model.history, next, coalesceKey ? { coalesceKey } : undefined);
  if (history === model.history) return model;
  return { ...model, history, revision: model.revision + 1 };
}

function toPhotoState(model: PhotoModel): PhotoEditorState {
  const snap = model.history.present;
  return {
    file: model.file,
    imageUrl: model.imageUrl,
    mediaPath: model.mediaPath,
    mediaName: model.mediaName,
    mediaMissing: model.mediaMissing,
    adjustments: snap.adjustments,
    filter: snap.filter,
    rotation: snap.rotation,
    flipH: snap.flipH,
    flipV: snap.flipV,
    crop: snap.crop,
    isCropping: model.isCropping,
  };
}

export function usePhotoEditor() {
  const [model, setModel] = useState<PhotoModel>(createPhotoModel);
  const modelRef = useRef(model);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  const loadImage = useCallback((file: File, mediaPath?: string | null) => {
    const url = URL.createObjectURL(file);
    const path = mediaPath === undefined ? fileMediaPath(file) : mediaPath;
    setModel((prev) => {
      revokeIfBlob(prev.imageUrl);
      return {
        ...createPhotoModel(),
        file,
        imageUrl: url,
        mediaPath: path,
        mediaName: file.name,
        revision: prev.revision + 1,
      };
    });
  }, []);

  const updateAdjustment = useCallback(
    <K extends keyof PhotoAdjustments>(key: K, value: PhotoAdjustments[K]) => {
      setModel((prev) =>
        commitPhoto(
          prev,
          (snap) => ({ ...snap, adjustments: { ...snap.adjustments, [key]: value } }),
          `adjustment:${String(key)}`,
        ),
      );
    },
    [],
  );

  const setFilter = useCallback((filter: PhotoFilterName) => {
    setModel((prev) => commitPhoto(prev, (snap) => ({ ...snap, filter })));
  }, []);

  const rotate = useCallback((degrees: number) => {
    setModel((prev) =>
      commitPhoto(prev, (snap) => ({
        ...snap,
        rotation: ((snap.rotation + degrees) % 360 + 360) % 360,
      })),
    );
  }, []);

  const flip = useCallback((axis: 'horizontal' | 'vertical') => {
    setModel((prev) =>
      commitPhoto(prev, (snap) => ({
        ...snap,
        flipH: axis === 'horizontal' ? !snap.flipH : snap.flipH,
        flipV: axis === 'vertical' ? !snap.flipV : snap.flipV,
      })),
    );
  }, []);

  const resetAdjustments = useCallback(() => {
    setModel((prev) =>
      commitPhoto(prev, (snap) => ({
        ...snap,
        adjustments: { ...DEFAULT_ADJUSTMENTS },
        filter: 'none',
        rotation: 0,
        flipH: false,
        flipV: false,
        crop: null,
      })),
    );
  }, []);

  const reset = useCallback(() => {
    setModel((prev) => {
      revokeIfBlob(prev.imageUrl);
      return { ...createPhotoModel(), revision: prev.revision + 1 };
    });
  }, []);

  const undo = useCallback(() => {
    setModel((prev) => {
      const history = undoHistory(prev.history);
      if (history === prev.history) return prev;
      return { ...prev, history, revision: prev.revision + 1 };
    });
  }, []);

  const redo = useCallback(() => {
    setModel((prev) => {
      const history = redoHistory(prev.history);
      if (history === prev.history) return prev;
      return { ...prev, history, revision: prev.revision + 1 };
    });
  }, []);

  const getEdits = useCallback((): PhotoEditSnapshot => structuredClone(modelRef.current.history.present), []);

  const setMedia = useCallback((media: MediaBinding) => {
    setModel((prev) => {
      if (prev.imageUrl !== media.url) revokeIfBlob(prev.imageUrl);
      return {
        ...prev,
        file: media.file,
        imageUrl: media.url,
        mediaPath: media.path,
        mediaName: media.name,
        mediaMissing: media.missing,
        revision: prev.revision + 1,
      };
    });
  }, []);

  const restore = useCallback((edits: PhotoEditSnapshot, media: MediaBinding | null) => {
    setModel((prev) => {
      if (prev.imageUrl !== media?.url) revokeIfBlob(prev.imageUrl);
      return {
        file: media?.file ?? null,
        imageUrl: media?.url ?? null,
        mediaPath: media?.path ?? null,
        mediaName: media?.name ?? null,
        mediaMissing: media?.missing ?? false,
        isCropping: false,
        history: createHistory(edits),
        revision: prev.revision + 1,
      };
    });
  }, []);

  const handleExport = useCallback(
    async (options: ExportOptions, saveFn?: (dataUrl: string, name: string) => Promise<void>): Promise<void> => {
      const current = modelRef.current;
      if (!current.imageUrl) return;
      setIsExporting(true);
      try {
        const snap = current.history.present;
        const cssFilter = buildCSSFilter(snap.adjustments, snap.filter);
        const transform = buildTransform(snap.rotation, snap.flipH, snap.flipV);
        const dataUrl = await exportImage(current.imageUrl, cssFilter, transform, options.format, options.quality);
        const ext = options.format === 'jpeg' ? 'jpg' : options.format;
        const fileName = `editpro-export.${ext}`;
        if (saveFn) {
          await saveFn(dataUrl, fileName);
        } else {
          const link = document.createElement('a');
          link.download = fileName;
          link.href = dataUrl;
          link.click();
        }
      } finally {
        setIsExporting(false);
      }
    },
    [],
  );

  const state = toPhotoState(model);
  const cssFilter = buildCSSFilter(state.adjustments, state.filter);
  const transform = buildTransform(state.rotation, state.flipH, state.flipV);

  return {
    state,
    cssFilter,
    transform,
    isExporting,
    revision: model.revision,
    canUndo: model.history.past.length > 0,
    canRedo: model.history.future.length > 0,
    loadImage,
    updateAdjustment,
    setFilter,
    rotate,
    flip,
    resetAdjustments,
    reset,
    undo,
    redo,
    getEdits,
    setMedia,
    restore,
    handleExport,
  };
}

export type PhotoEditorApi = ReturnType<typeof usePhotoEditor>;
