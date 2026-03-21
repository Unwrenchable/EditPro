import { useState, useCallback } from 'react';
import type { PhotoEditorState, PhotoAdjustments, PhotoFilterName, ExportOptions } from '../types';
import {
  DEFAULT_ADJUSTMENTS,
  buildCSSFilter,
  buildTransform,
  exportImage,
} from '../utils/imageFilters';

const initialState: PhotoEditorState = {
  file: null,
  imageUrl: null,
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  filter: 'none',
  rotation: 0,
  flipH: false,
  flipV: false,
  crop: null,
  isCropping: false,
};

export function usePhotoEditor() {
  const [state, setState] = useState<PhotoEditorState>(initialState);
  const [isExporting, setIsExporting] = useState(false);

  const loadImage = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setState({
      ...initialState,
      file,
      imageUrl: url,
    });
  }, []);

  const updateAdjustment = useCallback(
    <K extends keyof PhotoAdjustments>(key: K, value: PhotoAdjustments[K]) => {
      setState((prev) => ({
        ...prev,
        adjustments: { ...prev.adjustments, [key]: value },
      }));
    },
    []
  );

  const setFilter = useCallback((filter: PhotoFilterName) => {
    setState((prev) => ({ ...prev, filter }));
  }, []);

  const rotate = useCallback((degrees: number) => {
    setState((prev) => ({
      ...prev,
      rotation: ((prev.rotation + degrees) % 360 + 360) % 360,
    }));
  }, []);

  const flip = useCallback((axis: 'horizontal' | 'vertical') => {
    setState((prev) => ({
      ...prev,
      flipH: axis === 'horizontal' ? !prev.flipH : prev.flipH,
      flipV: axis === 'vertical' ? !prev.flipV : prev.flipV,
    }));
  }, []);

  const resetAdjustments = useCallback(() => {
    setState((prev) => ({
      ...prev,
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      filter: 'none',
      rotation: 0,
      flipH: false,
      flipV: false,
      crop: null,
    }));
  }, []);

  const reset = useCallback(() => {
    if (state.imageUrl) {
      URL.revokeObjectURL(state.imageUrl);
    }
    setState(initialState);
  }, [state.imageUrl]);

  const handleExport = useCallback(
    async (options: ExportOptions, saveFn?: (dataUrl: string, name: string) => Promise<void>): Promise<void> => {
      if (!state.imageUrl) return;
      setIsExporting(true);
      try {
        const cssFilter = buildCSSFilter(state.adjustments, state.filter);
        const transform = buildTransform(state.rotation, state.flipH, state.flipV);
        const dataUrl = await exportImage(
          state.imageUrl,
          cssFilter,
          transform,
          options.format,
          options.quality
        );
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
    [state]
  );

  const cssFilter = buildCSSFilter(state.adjustments, state.filter);
  const transform = buildTransform(state.rotation, state.flipH, state.flipV);

  return {
    state,
    cssFilter,
    transform,
    isExporting,
    loadImage,
    updateAdjustment,
    setFilter,
    rotate,
    flip,
    resetAdjustments,
    reset,
    handleExport,
  };
}
