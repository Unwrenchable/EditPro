import { useState } from 'react';
import type { AiTimeRange } from '../../../types/electron';
import { formatClock } from './useAiTask';

interface SilencePanelProps {
  sourcePath: string | null;
  busy: boolean;
  ranges: AiTimeRange[];
  onRanges: (ranges: AiTimeRange[]) => void;
  onRipple: (ranges: AiTimeRange[]) => void;
  run: <T,>(work: (bridge: NonNullable<Window['editpro']>) => Promise<T>) => Promise<T | null>;
}

export default function SilencePanel({ sourcePath, busy, ranges, onRanges, onRipple, run }: SilencePanelProps) {
  const [noiseDb, setNoiseDb] = useState(-35);
  const [hold, setHold] = useState(0.45);

  return (
    <section className="ai-block">
      <p className="section-subtitle">Silence</p>
      <p className="panel-hint ai-hint">
        Finds stretches quieter than the threshold. Padding keeps the attack of the next word.
      </p>
      <label className="ai-field">
        Noise threshold ({noiseDb} dB)
        <input type="range" min={-50} max={-20} value={noiseDb} disabled={busy} onChange={(event) => setNoiseDb(Number(event.target.value))} />
      </label>
      <label className="ai-field">
        Minimum length ({hold.toFixed(2)}s)
        <input type="range" min={0.2} max={2} step={0.05} value={hold} disabled={busy} onChange={(event) => setHold(Number(event.target.value))} />
      </label>
      <button
        type="button"
        className="btn-primary ai-go"
        disabled={busy || !sourcePath}
        onClick={() => {
          if (!sourcePath) return;
          void run(async (bridge) => {
            const found = await bridge.aiDetectSilence({
              sourcePath,
              noiseDb,
              minDuration: hold,
              padding: 0.08,
            });
            onRanges(found.ranges);
            return found;
          });
        }}
      >
        Detect silence
      </button>
      {ranges.length > 0 && (
        <>
          <ul className="ai-cues">
            {ranges.slice(0, 6).map((range) => (
              <li key={`${range.start}-${range.end}`}>
                <span>{formatClock(range.start)}</span>
                to {formatClock(range.end)}
              </li>
            ))}
          </ul>
          <div className="ai-row">
            <button type="button" className="reset-btn" disabled={busy} onClick={() => onRipple(ranges)}>
              Ripple timeline
            </button>
            <button
              type="button"
              className="reset-btn"
              disabled={busy || !sourcePath}
              onClick={() => {
                if (!sourcePath) return;
                void run((bridge) => bridge.aiRenderCut({ sourcePath, ranges }));
              }}
            >
              Save cut
            </button>
          </div>
        </>
      )}
    </section>
  );
}
