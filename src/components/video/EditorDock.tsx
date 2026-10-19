import React from 'react';

export type DockTab = 'multicam' | 'scopes' | 'titles' | 'exchange';

const TABS: { id: DockTab; label: string }[] = [
  { id: 'multicam', label: 'Multicam' },
  { id: 'scopes', label: 'Scopes' },
  { id: 'titles', label: 'Titles' },
  { id: 'exchange', label: 'Exchange' },
];

interface EditorDockProps {
  active: DockTab;
  onChange: (tab: DockTab) => void;
  children: React.ReactNode;
}

/** One monitor panel at a time so short desktop windows do not stack them over the timeline. */
const EditorDock: React.FC<EditorDockProps> = ({ active, onChange, children }) => (
  <section className="editor-dock" aria-label="Editor panels">
    <div className="panel-tabs editor-dock-tabs" role="tablist" aria-label="Editor panels">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`panel-tab${active === tab.id ? ' active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          <span className="panel-tab-label">{tab.label}</span>
        </button>
      ))}
    </div>
    <div className="editor-dock-body" role="tabpanel">
      {children}
    </div>
  </section>
);

export default EditorDock;
