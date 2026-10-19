import { useCallback, useState } from 'react';
import { planRemoval } from '../../../ai/editPlan';
import { useEditorSession } from '../../../session/editorSessionContext';
import type { AiTimeRange } from '../../../types/electron';
import { createTimelineId } from '../../../utils/video/timelineEdit';
import SilencePanel from './SilencePanel';
import { useAiTask } from './useAiTask';

export default function OfflineAiPanel() {
  const { video } = useEditorSession();
  const sourcePath = video.state.mediaPath;
  const { busy, progress, error, setError, run, cancel } = useAiTask();
  const [silence, setSilence] = useState<AiTimeRange[]>([]);
  const desktop = Boolean(window.editpro?.aiDetectSilence);

  const ripple = useCallback((ranges: AiTimeRange[]) => {
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
    setSilence([]);
  }, [setError, sourcePath, video]);

  return (
    <div className="ai-tools">
      <div className="info-box">
        Silence detection uses ffmpeg on this computer. Ripple tightens the timeline in one undo. Save cut writes a new file with only the kept picture and sound.
      </div>
      {!desktop && <p className="panel-hint ai-hint">Silence removal runs in the desktop app.</p>}
      {desktop && !sourcePath && (
        <p className="panel-hint ai-hint">Open a video from disk. A browser-only preview has no file ffmpeg can read.</p>
      )}
      {(progress || error) && (
        <div className="ai-status">
          {progress && <p>{progress}</p>}
          {error && <p className="ai-error">{error}</p>}
          {busy && <button type="button" className="reset-btn" onClick={cancel}>Cancel</button>}
        </div>
      )}
      <SilencePanel
        sourcePath={sourcePath}
        busy={busy}
        ranges={silence}
        onRanges={setSilence}
        onRipple={ripple}
        run={run}
      />
    </div>
  );
}
