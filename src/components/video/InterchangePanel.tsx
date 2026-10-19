import React, { useRef, useState } from 'react';
import type { TimelineClip, TimelineTrack } from '../../types';
import { exportInterchange, importInterchange, type InterchangeFormat } from '../../utils/interchange';
import { sequenceFromTimeline, timelineFromSequence } from '../../utils/interchange/model';
import { FRAME_RATES, supportsDropFrame } from '../../utils/interchange/timecode';

interface InterchangePanelProps {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  sequenceName: string;
  onReplace: (tracks: TimelineTrack[], clips: TimelineClip[]) => void;
}

const FORMATS: readonly { id: InterchangeFormat; label: string; extension: string }[] = [
  { id: 'edl', label: 'Export EDL', extension: 'edl' },
  { id: 'fcpxml', label: 'Export FCPXML', extension: 'fcpxml' },
  { id: 'xmeml', label: 'Export Premiere XML', extension: 'xml' },
];

/**
 * Import and export CMX 3600, FCPXML, and Premiere/FCP7 XML.
 * EDL has no frame rate of its own, so the rate chosen here is used on import and export.
 */
const InterchangePanel: React.FC<InterchangePanelProps> = ({
  tracks,
  clips,
  sequenceName,
  onReplace,
}) => {
  const [frameRate, setFrameRate] = useState(24);
  const [dropFrame, setDropFrame] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropAllowed = supportsDropFrame(frameRate);

  const download = (format: InterchangeFormat, extension: string) => {
    const sequence = sequenceFromTimeline(tracks, clips, {
      name: sequenceName || 'Sequence',
      frameRate,
      dropFrame: dropAllowed && dropFrame,
    });
    const text = exportInterchange(sequence, format);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
    const link = document.createElement('a');
    link.href = url;
    const safe = (sequence.name || 'sequence').replace(/[^\w.-]+/g, '_') || 'sequence';
    link.download = `${safe}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`Exported ${sequence.clips.length} clips as ${extension.toUpperCase()}`);
  };

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void file.text().then((text) => {
      try {
        const sequence = importInterchange(text, file.name, frameRate);
        const timeline = timelineFromSequence(sequence);
        onReplace(timeline.tracks, timeline.clips);
        setFrameRate(sequence.frameRate);
        setDropFrame(sequence.dropFrame);
        const count = timeline.clips.length;
        setMessage(`Imported ${count} clip${count === 1 ? '' : 's'} from ${file.name}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Could not read that interchange file');
      }
    }).catch(() => {
      setMessage('Could not read that interchange file');
    });
  };

  return (
    <section className="interchange-panel" aria-label="Interchange">
      <h2>Interchange</h2>
      <label className="speed-label" htmlFor="interchange-rate">
        Frame rate
      </label>
      <select
        id="interchange-rate"
        className="speed-select"
        aria-label="Sequence frame rate"
        value={String(frameRate)}
        onChange={(event) => {
          const next = Number(event.target.value);
          setFrameRate(next);
          if (!supportsDropFrame(next)) setDropFrame(false);
        }}
      >
        {FRAME_RATES.map((rate) => (
          <option key={rate} value={String(rate)}>
            {rate}
          </option>
        ))}
      </select>
      <label className="interchange-drop">
        <input
          type="checkbox"
          checked={dropAllowed && dropFrame}
          disabled={!dropAllowed}
          onChange={(event) => setDropFrame(event.target.checked)}
        />
        Drop frame
      </label>
      {FORMATS.map((format) => (
        <button
          key={format.id}
          type="button"
          className="btn-secondary"
          onClick={() => download(format.id, format.extension)}
        >
          {format.label}
        </button>
      ))}
      <button type="button" className="btn-secondary" onClick={() => inputRef.current?.click()}>
        Import
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".edl,.fcpxml,.xml,text/xml"
        className="hidden-input"
        aria-label="Import interchange file"
        onChange={onFile}
      />
      {message ? (
        <span className="interchange-message" role="status">
          {message}
        </span>
      ) : null}
    </section>
  );
};

export default InterchangePanel;
