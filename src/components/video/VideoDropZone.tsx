import React, { useRef, useCallback } from 'react';

interface VideoDropZoneProps {
  onFileSelected: (file: File) => void;
  videoUrl: string | null;
}

const ACCEPTED_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo'];
const ACCEPTED_EXTS = '.mp4,.webm,.ogg,.mov,.avi';

const VideoDropZone: React.FC<VideoDropZoneProps> = ({ onFileSelected, videoUrl }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type) && !file.name.match(/\.(mp4|webm|ogg|mov|avi)$/i)) {
        alert('Unsupported file type. Please use MP4, WebM, OGG, MOV, or AVI.');
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

  if (videoUrl) return null;

  return (
    <div
      className={`drop-zone ${isDragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Drop video here or click to open"
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
    >
      <div className="drop-zone-content">
        <div className="drop-icon">🎬</div>
        <p className="drop-title">Drop your video here</p>
        <p className="drop-subtitle">or click to browse</p>
        <p className="drop-hint">Supports MP4, WebM, MOV, AVI, OGG</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTS}
        className="hidden-input"
        onChange={handleInputChange}
        aria-label="Open video file"
      />
    </div>
  );
};

export default VideoDropZone;
