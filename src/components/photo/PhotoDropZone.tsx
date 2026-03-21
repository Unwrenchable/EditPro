import React, { useRef, useCallback } from 'react';

interface PhotoDropZoneProps {
  onFileSelected: (file: File) => void;
  imageUrl: string | null;
  cssFilter: string;
  transform: string;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];

const PhotoDropZone: React.FC<PhotoDropZoneProps> = ({
  onFileSelected,
  imageUrl,
  cssFilter,
  transform,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        alert('Unsupported file type. Please use JPG, PNG, WEBP, GIF, or BMP.');
        return;
      }
      onFileSelected(file);
    },
    [onFileSelected]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  if (imageUrl) {
    return (
      <div className="canvas-area">
        <div className="image-container">
          <img
            src={imageUrl}
            alt="Editing preview"
            className="preview-image"
            style={{
              filter: cssFilter,
              transform: transform !== 'none' ? transform : undefined,
            }}
            draggable={false}
          />
        </div>
        <div className="canvas-overlay-actions">
          <button
            className="change-image-btn"
            onClick={() => inputRef.current?.click()}
            title="Open a different image"
          >
            Open Image
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          className="hidden-input"
          onChange={handleInputChange}
          aria-label="Open image file"
        />
      </div>
    );
  }

  return (
    <div
      className={`drop-zone ${isDragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Drop image here or click to open"
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
    >
      <div className="drop-zone-content">
        <div className="drop-icon">🖼</div>
        <p className="drop-title">Drop your photo here</p>
        <p className="drop-subtitle">or click to browse</p>
        <p className="drop-hint">Supports JPG, PNG, WEBP, GIF, BMP</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        className="hidden-input"
        onChange={handleInputChange}
        aria-label="Open image file"
      />
    </div>
  );
};

export default PhotoDropZone;
