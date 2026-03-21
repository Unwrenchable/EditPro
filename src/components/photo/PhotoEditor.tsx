import React, { useState } from 'react';
import { usePhotoEditor } from '../../hooks/usePhotoEditor';
import PhotoDropZone from './PhotoDropZone';
import PhotoAdjustmentPanel from './PhotoAdjustmentPanel';
import type { ExportOptions } from '../../types';
import { formatFileSize } from '../../utils/imageFilters';

interface ExportModalProps {
  onExport: (options: ExportOptions) => void;
  onClose: () => void;
}

const ExportModal: React.FC<ExportModalProps> = ({ onExport, onClose }) => {
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

interface PhotoEditorProps {
  showExport: boolean;
  onExportClose: () => void;
}

const PhotoEditor: React.FC<PhotoEditorProps> = ({ showExport, onExportClose }) => {
  const editor = usePhotoEditor();
  const { state, cssFilter, transform } = editor;

  return (
    <div className="editor-layout">
      <div className="editor-main">
        <PhotoDropZone
          onFileSelected={editor.loadImage}
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

export default PhotoEditor;
