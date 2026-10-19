import React, { useEffect, useRef, useState } from 'react';
import type { EditorMode } from '../../types';
import type { RecentFileEntry } from '../../utils/recentFiles';

interface TopBarProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onExport: () => void;
  canExport: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onOpen?: () => void;
  onSave?: () => void;
  onSaveAs?: () => void;
  recentFiles?: RecentFileEntry[];
  onOpenRecent?: (path: string) => void;
  projectName?: string;
  dirty?: boolean;
  statusMessage?: string | null;
}

const TopBar: React.FC<TopBarProps> = ({
  mode,
  onModeChange,
  onExport,
  canExport,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onOpen,
  onSave,
  onSaveAs,
  recentFiles = [],
  onOpenRecent,
  projectName = 'Untitled',
  dirty = false,
  statusMessage = null,
}) => {
  const [recentOpen, setRecentOpen] = useState(false);
  const recentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!recentOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!recentRef.current?.contains(event.target as Node)) setRecentOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    return () => window.removeEventListener('mousedown', onPointer);
  }, [recentOpen]);

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
        <button
          className={`mode-btn mode-btn--magic ${mode === 'magic' ? 'active' : ''}`}
          onClick={() => onModeChange('magic')}
          aria-pressed={mode === 'magic'}
        >
          <span className="mode-icon">✨</span> Magic Movie
        </button>
      </nav>

      <div className="topbar-actions">
        <div className="history-group" role="group" aria-label="History">
          <button
            type="button"
            className="history-btn"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
          >
            ↩
          </button>
          <button
            type="button"
            className="history-btn"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
          >
            ↪
          </button>
        </div>

        <span className={`project-name ${dirty ? 'dirty' : ''}`} title={projectName}>
          {projectName}
          {dirty ? '*' : ''}
        </span>

        <button type="button" className="file-btn" onClick={onOpen} aria-label="Open project">
          Open
        </button>
        <div className="recent-menu" ref={recentRef}>
          <button
            type="button"
            className="file-btn"
            aria-label="Recent projects"
            aria-expanded={recentOpen}
            aria-haspopup="menu"
            onClick={() => setRecentOpen((open) => !open)}
          >
            Recent
          </button>
          {recentOpen && (
            <ul className="recent-dropdown" role="menu">
              {recentFiles.length === 0 ? (
                <li className="recent-empty">No recent projects</li>
              ) : (
                recentFiles.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      role="menuitem"
                      className="recent-item"
                      onClick={() => {
                        setRecentOpen(false);
                        onOpenRecent?.(entry.path);
                      }}
                    >
                      <span className="recent-item-name">{entry.name}</span>
                      <span className="recent-item-mode">{entry.mode}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <button type="button" className="file-btn" onClick={onSave} aria-label="Save project" title="Save (Ctrl+S)">
          Save
        </button>
        <button
          type="button"
          className="file-btn"
          onClick={onSaveAs}
          aria-label="Save project as"
          title="Save As (Ctrl+Shift+S)"
        >
          Save As
        </button>
        {statusMessage && (
          <span className="topbar-status" role="status">
            {statusMessage}
          </span>
        )}
        <button className="export-btn" onClick={onExport} disabled={!canExport} aria-label="Export file">
          ↓ Export
        </button>
      </div>
    </header>
  );
};

export default TopBar;
