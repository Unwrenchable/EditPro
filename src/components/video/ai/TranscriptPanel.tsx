import { useEffect, useState } from 'react';
import { shiftWords, type TranscriptWord } from '../../../ai/editPlan';
import { diffTranscript, transcriptText } from '../../../ai/transcript';
import type { AiTimeRange } from '../../../types/electron';

interface TranscriptPanelProps {
  sourcePath: string | null;
  busy: boolean;
  words: readonly TranscriptWord[];
  onWords: (words: TranscriptWord[]) => void;
  onRipple: (ranges: AiTimeRange[], nextWords?: TranscriptWord[]) => void;
  run: <T,>(work: (bridge: NonNullable<Window['editpro']>) => Promise<T>) => Promise<T | null>;
}

export default function TranscriptPanel({
  sourcePath, busy, words, onWords, onRipple, run,
}: TranscriptPanelProps) {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft(transcriptText(words));
  }, [words]);

  return (
    <section className="ai-block">
      <p className="section-subtitle">Text-based edit</p>
      <p className="panel-hint ai-hint">
        Delete a word and apply. That word’s picture and sound leave the timeline. A shortened spelling keeps the media and updates the caption.
      </p>
      <textarea
        className="ai-script"
        value={draft}
        disabled={busy || words.length === 0}
        placeholder={words.length === 0 ? 'Transcribe to edit from the text.' : ''}
        onChange={(event) => setDraft(event.target.value)}
        rows={5}
      />
      <div className="ai-row">
        <button
          type="button"
          className="btn-primary ai-go"
          disabled={busy || words.length === 0}
          onClick={() => {
            const diff = diffTranscript(words, draft);
            if (diff.ranges.length === 0) {
              onWords(diff.words);
              return;
            }
            const nextWords = shiftWords(diff.words, diff.ranges);
            onRipple(diff.ranges, nextWords);
            onWords(nextWords);
          }}
        >
          Delete matching media
        </button>
        <button
          type="button"
          className="reset-btn"
          disabled={busy || !sourcePath || words.length === 0}
          onClick={() => {
            if (!sourcePath) return;
            const diff = diffTranscript(words, draft);
            if (diff.ranges.length === 0) return;
            void run((bridge) => bridge.aiRenderCut({ sourcePath, ranges: diff.ranges }));
          }}
        >
          Save cut
        </button>
      </div>
    </section>
  );
}
