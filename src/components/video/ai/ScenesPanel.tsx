import { useState } from 'react';
import type { AiSceneHit } from '../../../types/electron';
import { formatClock } from './useAiTask';

interface ScenesPanelProps {
  sourcePath: string | null;
  busy: boolean;
  onMark: (hits: AiSceneHit[]) => void;
  run: <T,>(work: (bridge: NonNullable<Window['editpro']>) => Promise<T>) => Promise<T | null>;
}

export default function ScenesPanel({ sourcePath, busy, onMark, run }: ScenesPanelProps) {
  const [threshold, setThreshold] = useState(0.3);
  const [hits, setHits] = useState<AiSceneHit[]>([]);

  return (
    <section className="ai-block">
      <p className="section-subtitle">Scene detection</p>
      <p className="panel-hint ai-hint">
        ffmpeg scores each frame change. Hits above the threshold become timeline markers in one undo step.
      </p>
      <label className="ai-field">
        Threshold ({threshold.toFixed(2)})
        <input
          type="range"
          min={0.1}
          max={0.8}
          step={0.05}
          value={threshold}
          disabled={busy}
          onChange={(event) => setThreshold(Number(event.target.value))}
        />
      </label>
      <button
        type="button"
        className="btn-primary ai-go"
        disabled={busy || !sourcePath}
        onClick={() => {
          if (!sourcePath) return;
          void run(async (bridge) => {
            const found = await bridge.aiDetectScenes({ sourcePath, threshold });
            setHits(found.hits);
            if (found.hits.length > 0) onMark(found.hits);
            return found;
          });
        }}
      >
        Detect scenes
      </button>
      {hits.length > 0 && (
        <ul className="ai-cues">
          {hits.slice(0, 8).map((hit) => (
            <li key={`${hit.time}-${hit.score}`}>
              <span>{formatClock(hit.time)}</span>
              score {hit.score.toFixed(2)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
