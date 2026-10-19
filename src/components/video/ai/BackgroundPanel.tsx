import { useState } from 'react';
import type { AiModelStatus } from '../../../types/electron';
import { formatBytes } from './useAiTask';

interface BackgroundPanelProps {
  sourcePath: string | null;
  busy: boolean;
  matte: AiModelStatus | null;
  onRefresh: () => Promise<void>;
  run: <T,>(work: (bridge: NonNullable<Window['editpro']>) => Promise<T>) => Promise<T | null>;
}

export default function BackgroundPanel({ sourcePath, busy, matte, onRefresh, run }: BackgroundPanelProps) {
  const [mode, setMode] = useState<'transparent' | 'color'>('transparent');
  const [color, setColor] = useState('#00ff00');

  return (
    <section className="ai-block">
      <p className="section-subtitle">Background removal</p>
      <p className="panel-hint ai-hint">
        A local portrait matte runs in this app. Transparent output is WebM with alpha. A color fill is H.264.
        {matte ? ` Model ${formatBytes(matte.bytes)}${matte.ready ? ', ready' : ', not downloaded'}.` : ''}
      </p>
      <div className="ai-row">
        <button type="button" className={`reset-btn${mode === 'transparent' ? ' ai-on' : ''}`} disabled={busy} onClick={() => setMode('transparent')}>
          Transparent
        </button>
        <button type="button" className={`reset-btn${mode === 'color' ? ' ai-on' : ''}`} disabled={busy} onClick={() => setMode('color')}>
          Color fill
        </button>
      </div>
      {mode === 'color' && (
        <label className="ai-field">
          Fill
          <input type="color" value={color} disabled={busy} onChange={(event) => setColor(event.target.value)} />
        </label>
      )}
      <div className="ai-row">
        <button
          type="button"
          className="reset-btn"
          disabled={busy || matte?.ready === true}
          onClick={() => {
            void run(async (bridge) => {
              await bridge.aiDownload({ kind: 'matte' });
              await onRefresh();
              return true;
            });
          }}
        >
          Download model
        </button>
        <button
          type="button"
          className="btn-primary ai-go"
          disabled={busy || !sourcePath}
          onClick={() => {
            if (!sourcePath) return;
            void run((bridge) => bridge.aiRemoveBackground({ sourcePath, mode, color: color.slice(1) }));
          }}
        >
          Remove background
        </button>
      </div>
    </section>
  );
}
