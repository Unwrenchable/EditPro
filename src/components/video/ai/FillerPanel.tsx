import { useState } from 'react';
import { fillerRanges, type FillerMode } from '../../../ai/fillers';
import type { TranscriptWord } from '../../../ai/editPlan';
import type { AiTimeRange } from '../../../types/electron';
import { formatClock } from './useAiTask';

interface FillerPanelProps {
  sourcePath: string | null;
  busy: boolean;
  words: readonly TranscriptWord[];
  onRipple: (ranges: AiTimeRange[]) => void;
  run: <T,>(work: (bridge: NonNullable<Window['editpro']>) => Promise<T>) => Promise<T | null>;
}

export default function FillerPanel({ sourcePath, busy, words, onRipple, run }: FillerPanelProps) {
  const [mode, setMode] = useState<FillerMode>('standard');
  const [ranges, setRanges] = useState<AiTimeRange[]>([]);

  return (
    <section className="ai-block">
      <p className="section-subtitle">Filler words</p>
      <p className="panel-hint ai-hint">
        Uses the transcript already on this machine. Standard removes um, uh, and hmm. Aggressive also removes “you know”, “i mean”, and “like”.
      </p>
      <div className="ai-row">
        <button type="button" className={`reset-btn${mode === 'standard' ? ' ai-on' : ''}`} disabled={busy} onClick={() => setMode('standard')}>
          Standard
        </button>
        <button type="button" className={`reset-btn${mode === 'aggressive' ? ' ai-on' : ''}`} disabled={busy} onClick={() => setMode('aggressive')}>
          Aggressive
        </button>
      </div>
      <button
        type="button"
        className="btn-primary ai-go"
        disabled={busy || words.length === 0}
        onClick={() => setRanges(fillerRanges(words, mode))}
      >
        {words.length === 0 ? 'Transcribe first' : 'Find fillers'}
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
