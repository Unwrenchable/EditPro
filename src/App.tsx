import React, { useState, useCallback, useEffect } from 'react';
import TopBar from './components/layout/TopBar';
import AppChrome from './components/shell/AppChrome';
import VideoEditor from './components/video/VideoEditor';
import MagicMovieView from './components/magic/MagicMovieView';
import PhotoDropZone from './components/photo/PhotoDropZone';
import PhotoAdjustmentPanel from './components/photo/PhotoAdjustmentPanel';
import { EditorSessionProvider } from './session/EditorSession';
import { useEditorSession } from './session/editorSessionContext';
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
}

const PhotoEditorView: React.FC<PhotoEditorViewProps> = ({ showExport, onExportClose }) => {
  const { photo: editor, relinkPhoto } = useEditorSession();
  const { state, cssFilter, transform } = editor;

  const handleLoadImage = (file: File) => {
    editor.loadImage(file);
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
        {state.mediaMissing && (
          <div className="info-box media-missing-banner">
            <span>Image file is offline{state.mediaName ? `: ${state.mediaName}` : ''}.</span>
            <button type="button" className="btn-secondary" onClick={relinkPhoto}>
              Relink
            </button>
          </div>
        )}
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

const AppFrame: React.FC<{
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  showExport: boolean;
  onExport: () => void;
  onExportClose: () => void;
  magicResult: MagicMovieResult | null;
  onMagicApply: (file: File, plan: MagicMoviePlan) => void;
  videoKey: number;
  videoExportRequest: number;
}> = ({ mode, onModeChange, showExport, onExport, onExportClose, magicResult, onMagicApply, videoKey, videoExportRequest }) => {
  const session = useEditorSession();
  useEffect(() => {
    const bridge = window.editpro;
    if (!bridge?.onMenu) return;
    return bridge.onMenu('menu:export', onExport);
  }, [onExport]);
  return (
    <div className="app">
      <TopBar
        mode={mode}
        onModeChange={onModeChange}
        onExport={onExport}
        canExport={
          (mode === 'photo' && !!session.photo.state.imageUrl) ||
          (mode === 'video' && !!session.video.state.videoUrl && !session.video.state.mediaMissing)
        }
        canUndo={session.canUndo}
        canRedo={session.canRedo}
        onUndo={session.undo}
        onRedo={session.redo}
        onOpen={() => void session.openProject()}
        onSave={() => void session.save()}
        onSaveAs={() => void session.saveAs()}
        recentFiles={session.recent}
        onOpenRecent={(path) => void session.openRecent(path)}
        projectName={session.projectName}
        dirty={session.dirty}
        statusMessage={session.statusMessage}
      />
      <main className="app-main">
        {mode === 'photo' ? (
          <PhotoEditorView showExport={showExport} onExportClose={onExportClose} />
        ) : mode === 'magic' ? (
          <MagicMovieView onApply={onMagicApply} />
        ) : (
          <VideoEditor
            key={videoKey}
            initialMagicPlan={magicResult?.plan}
            initialFile={magicResult?.file}
            exportRequestId={videoExportRequest}
          />
        )}
      </main>
      <AppChrome />
    </div>
  );
};

const App: React.FC = () => {
  const [mode, setMode] = useState<EditorMode>('photo');
  const [showExport, setShowExport] = useState(false);
  const [videoExportRequest, setVideoExportRequest] = useState(0);
  const [magicResult, setMagicResult] = useState<MagicMovieResult | null>(null);
  // Bump this key to force VideoEditor to remount when a new magic plan is applied
  const [videoKey, setVideoKey] = useState(0);

  const handleModeChange = useCallback((m: EditorMode) => {
    setMode(m);
    setShowExport(false);
  }, []);

  const handleExport = useCallback(() => {
    if (mode === 'video') setVideoExportRequest((n) => n + 1);
    else setShowExport(true);
  }, [mode]);

  const handleMagicApply = useCallback((file: File, plan: MagicMoviePlan) => {
    setMagicResult({ file, plan });
    setVideoKey((k) => k + 1);
    setMode('video');
  }, []);

  return (
    <EditorSessionProvider mode={mode} onModeChange={handleModeChange}>
      <AppFrame
        mode={mode}
        onModeChange={handleModeChange}
        showExport={showExport}
        onExport={handleExport}
        onExportClose={() => setShowExport(false)}
        magicResult={magicResult}
        onMagicApply={handleMagicApply}
        videoKey={videoKey}
        videoExportRequest={videoExportRequest}
      />
    </EditorSessionProvider>
  );
};

export default App;
