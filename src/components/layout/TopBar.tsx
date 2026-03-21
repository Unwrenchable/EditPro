import React from 'react';
import type { EditorMode } from '../../types';

interface TopBarProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onExport: () => void;
  canExport: boolean;
}

const TopBar: React.FC<TopBarProps> = ({ mode, onModeChange, onExport, canExport }) => {
  return (
    <header className="topbar">
      <div className="topbar-logo">
        <span className="logo-icon">✦</span>
        <span className="logo-text">Edit<strong>Pro</strong></span>
      </div>

      <nav className="topbar-modes">
        <button
          className={`mode-btn ${mode === 'photo' ? 'active' : ''}`}
          onClick={() => onModeChange('photo')}
          aria-pressed={mode === 'photo'}
        >
          <span className="mode-icon">🖼</span> Photo
        </button>
        <button
          className={`mode-btn ${mode === 'video' ? 'active' : ''}`}
          onClick={() => onModeChange('video')}
          aria-pressed={mode === 'video'}
        >
          <span className="mode-icon">🎬</span> Video
        </button>
      </nav>

      <div className="topbar-actions">
        <button
          className="export-btn"
          onClick={onExport}
          disabled={!canExport}
          aria-label="Export file"
        >
          ↓ Export
        </button>
      </div>
    </header>
  );
};

export default TopBar;
