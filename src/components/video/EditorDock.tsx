import React from 'react';

export type DockTab = 'multicam' | 'scopes' | 'titles' | 'exchange';

const TABS: { id: DockTab; label: string }[] = [
  { id: 'multicam', label: 'Multicam' },
  { id: 'scopes', label: 'Scopes' },
  { id: 'titles', label: 'Titles' },
  { id: 'exchange', label: 'Exchange' },
];

interface EditorDockProps {
  open: boolean;
  active: DockTab;
  onChange: (tab: DockTab) => void;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

/**
 * Multicam, scopes, titles, and interchange share one strip.
 * It stays collapsed until a tab is chosen so the monitor keeps the height.
 */
const EditorDock: React.FC<EditorDockProps> = ({ open, active, onChange, onOpenChange, children }) => (
  <section className={`editor-dock${open ? '' : ' is-collapsed'}`} aria-label="Editor panels">
    <div className="panel-tabs editor-dock-tabs" role="tablist" aria-label="Editor panels">
      {TABS.map((tab) => {
        const selected = open && active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-expanded={selected}
            className={`panel-tab${selected ? ' active' : ''}`}
            onClick={() => {
              if (selected) onOpenChange(false);
              else {
                onChange(tab.id);
                onOpenChange(true);
              }
            }}
          >
            <span className="panel-tab-label">{tab.label}</span>
          </button>
        );
      })}
    </div>
    {open && (
      <div className="editor-dock-body" role="tabpanel">
        {children}
      </div>
    )}
  </section>
);

export default EditorDock;
