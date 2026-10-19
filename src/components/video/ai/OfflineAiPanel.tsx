import { useCallback, useEffect, useState } from 'react';
import { planRemoval, shiftWords, type TranscriptWord } from '../../../ai/editPlan';
import { useEditorSession } from '../../../session/editorSessionContext';
import type { AiSceneHit, AiStatus, AiTimeRange } from '../../../types/electron';
import { createTimelineId } from '../../../utils/video/timelineEdit';
import CaptionsPanel from './CaptionsPanel';
import FillerPanel from './FillerPanel';
import ScenesPanel from './ScenesPanel';
import SilencePanel from './SilencePanel';
import TranscriptPanel from './TranscriptPanel';
import { useAiTask } from './useAiTask';

export default function OfflineAiPanel() {
  const { video } = useEditorSession();
  const sourcePath = video.state.mediaPath;
  const { busy, progress, error, setError, run, cancel } = useAiTask();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [words, setWords] = useState<TranscriptWord[]>([]);
  const [silence, setSilence] = useState<AiTimeRange[]>([]);
  const desktop = Boolean(window.editpro?.aiTranscribe);

  const refresh = useCallback(async () => {
    const bridge = window.editpro;
    if (!bridge?.aiStatus) return;
    try {
      setStatus(await bridge.aiStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the speech models');
    }
  }, [setError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ripple = useCallback((ranges: AiTimeRange[], nextWords?: TranscriptWord[]) => {
    if (!sourcePath) {
      setError('Open a video from disk so the cut can name the source file.');
      return;
    }
    if (!(video.state.duration > 0.05)) {
      setError('Wait for the video to finish loading.');
      return;
    }
    if (ranges.length === 0) return;
    video.applyVideoEdit((snap) => planRemoval(
      snap,
      ranges,
      { src: sourcePath, duration: video.state.duration },
      () => createTimelineId('clip'),
    ));
    setWords((current) => nextWords ?? shiftWords(current, ranges));
    setSilence([]);
  }, [setError, sourcePath, video]);

  const markScenes = useCallback((hits: AiSceneHit[]) => {
    video.applyVideoEdit((snap) => {
      const stamped = Date.now();
      const markers = hits.map((hit, index) => ({
        id: `m_scene_${stamped}_${index}`,
        time: hit.time,
        label: 'Scene cut',
        color: 'green' as const,
      }));
      return {
        ...snap,
        markers: [...snap.markers, ...markers].sort((a, b) => a.time - b.time),
      };
    });
  }, [video]);

  return (
    <div className="ai-tools">
      <div className="info-box">
        Captions, silence, scenes, and background removal run on this computer. Speech and matte models download once, then stay offline.
      </div>
      {!desktop && <p className="panel-hint ai-hint">These tools run in the desktop app.</p>}
      {desktop && !sourcePath && (
        <p className="panel-hint ai-hint">Open a video from disk. A browser-only preview has no file these tools can read.</p>
      )}
      {(progress || error) && (
        <div className="ai-status">
          {progress && <p>{progress}</p>}
          {error && <p className="ai-error">{error}</p>}
          {busy && <button type="button" className="reset-btn" onClick={cancel}>Cancel</button>}
        </div>
      )}
      <ScenesPanel sourcePath={sourcePath} busy={busy} onMark={markScenes} run={run} />
      <SilencePanel
        sourcePath={sourcePath}
        busy={busy}
        ranges={silence}
        onRanges={setSilence}
        onRipple={ripple}
        run={run}
      />
      <CaptionsPanel
        sourcePath={sourcePath}
        busy={busy}
        models={status?.models ?? []}
        cliReady={status?.whisperCli ?? false}
        onWords={setWords}
        onRefresh={refresh}
        run={run}
      />
      <FillerPanel sourcePath={sourcePath} busy={busy} words={words} onRipple={ripple} run={run} />
      <TranscriptPanel
        sourcePath={sourcePath}
        busy={busy}
        words={words}
        onWords={setWords}
        onRipple={ripple}
        run={run}
      />
      <p className="panel-hint ai-hint">
        Deleting a word ripples that picture and sound out of the timeline in one undo. Save cut writes a new file with only the kept media.
      </p>
    </div>
  );
}
