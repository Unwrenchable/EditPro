import { useState } from 'react';
import type { AiCaptionCue, AiModelStatus, AiTranscriptWord } from '../../../types/electron';
import { formatBytes, formatClock } from './useAiTask';

interface CaptionsPanelProps {
  sourcePath: string | null;
  busy: boolean;
  models: AiModelStatus[];
  cliReady: boolean;
  onWords: (words: AiTranscriptWord[]) => void;
  onRefresh: () => Promise<void>;
  run: <T,>(work: (bridge: NonNullable<Window['editpro']>) => Promise<T>) => Promise<T | null>;
}

export default function CaptionsPanel({
  sourcePath, busy, models, cliReady, onWords, onRefresh, run,
}: CaptionsPanelProps) {
  const [modelId, setModelId] = useState('tiny.en');
  const [cues, setCues] = useState<AiCaptionCue[]>([]);
  const selected = models.find((model) => model.id === modelId) ?? models[0];

  return (
    <section className="ai-block">
      <p className="section-subtitle">Captions</p>
      <p className="panel-hint ai-hint">
        Whisper runs on this computer. The speech model downloads once, then captions, SRT, VTT, and burn-in stay offline.
      </p>
      <label className="ai-field">
        Model
        <select value={selected?.id ?? 'tiny.en'} onChange={(event) => setModelId(event.target.value)} disabled={busy}>
          {(models.length > 0 ? models : [{ id: 'tiny.en', label: 'Tiny English', bytes: 77_704_715, ready: false }]).map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} · {formatBytes(model.bytes)}{model.ready ? ' · ready' : ''}
            </option>
          ))}
        </select>
      </label>
      <p className="panel-hint ai-hint">{cliReady ? 'whisper.cpp is installed.' : 'whisper.cpp downloads with the first transcript.'}</p>
      <div className="ai-row">
        <button
          type="button"
          className="reset-btn"
          disabled={busy || !selected || selected.ready}
          onClick={() => {
            if (!selected) return;
            void run(async (bridge) => {
              await bridge.aiDownload({ kind: 'model', modelId: selected.id });
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
            if (!sourcePath || !selected) return;
            void run(async (bridge) => {
              const result = await bridge.aiTranscribe({ sourcePath, modelId: selected.id, language: 'en' });
              setCues(result.cues);
              onWords(result.cues.flatMap((cue) => cue.words));
              await onRefresh();
              return result;
            });
          }}
        >
          Transcribe
        </button>
      </div>
      {cues.length > 0 && (
        <>
          <ol className="ai-cues">
            {cues.slice(0, 8).map((cue) => (
              <li key={cue.id}>
                <span>{formatClock(cue.start)}</span>
                {cue.text}
              </li>
            ))}
          </ol>
          {cues.length > 8 && <p className="panel-hint ai-hint">{cues.length - 8} more captions</p>}
          <div className="ai-row">
            <button type="button" className="reset-btn" disabled={busy} onClick={() => void run((bridge) => bridge.aiSaveCaptions({ cues, format: 'srt' }))}>
              Save SRT
            </button>
            <button type="button" className="reset-btn" disabled={busy} onClick={() => void run((bridge) => bridge.aiSaveCaptions({ cues, format: 'vtt' }))}>
              Save VTT
            </button>
          </div>
          <button
            type="button"
            className="reset-btn"
            disabled={busy || !sourcePath}
            onClick={() => {
              if (!sourcePath) return;
              void run((bridge) => bridge.aiBurnCaptions({ sourcePath, cues }));
            }}
          >
            Burn into video
          </button>
        </>
      )}
    </section>
  );
}
