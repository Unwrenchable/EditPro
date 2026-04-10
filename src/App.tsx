import React, { useState, useCallback } from 'react';
import TopBar from './components/layout/TopBar';
import VideoEditor from './components/video/VideoEditor';
import MagicMovieView from './components/magic/MagicMovieView';
import { usePhotoEditor } from './hooks/usePhotoEditor';
import PhotoDropZone from './components/photo/PhotoDropZone';
import PhotoAdjustmentPanel from './components/photo/PhotoAdjustmentPanel';
import { formatFileSize } from './utils/imageFilters';
import type { EditorMode, ExportOptions, MagicMoviePlan } from './types';
import './App.css';

// ─── Export Modal ────────────────────────────────────────────────────────────

const ExportModal: React.FC<{ onExport: (opts: ExportOptions) => void; onClose: () => void }> = ({
  onExport,
  onClose,
}) => {
  const [format, setFormat] = useState<ExportOptions['format']>('png');
  const [quality, setQuality] = useState(90);
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Export options">
      <div className="modal">
        <h2 className="modal-title">Export Photo</h2>
        <div className="modal-body">
          <div className="form-row">
            <label className="form-label">Format</label>
            <select
              className="form-select"
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportOptions['format'])}
            >
              <option value="png">PNG (lossless)</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </div>
          {format !== 'png' && (
            <div className="form-row">
              <label className="form-label">Quality: {quality}%</label>
              <input
                type="range"
                min={10}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="slider"
                aria-label="Export quality"
              />
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              onExport({ format, quality: quality / 100 });
              onClose();
            }}
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Photo Editor (inline, shares state with App for export button) ──────────

interface PhotoEditorViewProps {
  showExport: boolean;
  onExportClose: () => void;
  onLoadedChange: (loaded: boolean) => void;
}

const PhotoEditorView: React.FC<PhotoEditorViewProps> = ({
  showExport,
  onExportClose,
  onLoadedChange,
}) => {
  const editor = usePhotoEditor();
  const { state, cssFilter, transform } = editor;

  const handleLoadImage = (file: File) => {
    editor.loadImage(file);
    onLoadedChange(true);
  };

  return (
    <div className="editor-layout">
      <div className="editor-main">
        <PhotoDropZone
          onFileSelected={handleLoadImage}
          imageUrl={state.imageUrl}
          cssFilter={cssFilter}
          transform={transform}
        />
        {state.file && (
          <div className="file-info-bar">
            <span>{state.file.name}</span>
            <span>{formatFileSize(state.file.size)}</span>
          </div>
        )}
      </div>

      <PhotoAdjustmentPanel
        adjustments={state.adjustments}
        filter={state.filter}
        rotation={state.rotation}
        imageUrl={state.imageUrl}
        onAdjustmentChange={editor.updateAdjustment}
        onFilterChange={editor.setFilter}
        onRotate={editor.rotate}
        onFlip={editor.flip}
        onReset={editor.resetAdjustments}
      />

      {showExport && state.imageUrl && (
        <ExportModal
          onExport={(opts) => {
            void editor.handleExport(opts);
          }}
          onClose={onExportClose}
        />
      )}
    </div>
  );
};

// ─── App Root ────────────────────────────────────────────────────────────────

interface MagicMovieResult {
  file: File;
  plan: MagicMoviePlan;
}

const App: React.FC = () => {
  const [mode, setMode] = useState<EditorMode>('photo');
  const [showExport, setShowExport] = useState(false);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [magicResult, setMagicResult] = useState<MagicMovieResult | null>(null);
  // Bump this key to force VideoEditor to remount when a new magic plan is applied
  const [videoKey, setVideoKey] = useState(0);

  const handleModeChange = useCallback(
    (m: EditorMode) => {
      setMode(m);
      setShowExport(false);
    },
    []
  );

  const handleMagicApply = useCallback((file: File, plan: MagicMoviePlan) => {
    setMagicResult({ file, plan });
    setVideoKey((k) => k + 1);
    setMode('video');
  }, []);

  return (
    <div className="app">
      <TopBar
        mode={mode}
        onModeChange={handleModeChange}
        onExport={() => setShowExport(true)}
        canExport={mode === 'photo' && photoLoaded}
      />
      <main className="app-main">
        {mode === 'photo' ? (
          <PhotoEditorView
            showExport={showExport}
            onExportClose={() => setShowExport(false)}
            onLoadedChange={setPhotoLoaded}
          />
        ) : mode === 'magic' ? (
          <MagicMovieView onApply={handleMagicApply} />
        ) : (
          <VideoEditor
            key={videoKey}
            initialMagicPlan={magicResult?.plan}
            initialFile={magicResult?.file}
          />
        )}
      </main>
    </div>
  );
};

export default App;
