import { useCallback } from 'react';
import { useEditorSession } from '../../../session/editorSessionContext';
import type { AiSceneHit } from '../../../types/electron';
import ScenesPanel from './ScenesPanel';
import { useAiTask } from './useAiTask';

export default function OfflineAiPanel() {
  const { video } = useEditorSession();
  const sourcePath = video.state.mediaPath;
  const { busy, progress, error, run, cancel } = useAiTask();
  const desktop = Boolean(window.editpro?.aiDetectScenes);

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
        Scene detection uses ffmpeg’s frame-change score on this computer. Nothing is uploaded.
      </div>
      {!desktop && <p className="panel-hint ai-hint">Scene detection runs in the desktop app.</p>}
      {desktop && !sourcePath && (
        <p className="panel-hint ai-hint">Open a video from disk. A browser-only preview has no file ffmpeg can score.</p>
      )}
      {(progress || error) && (
        <div className="ai-status">
          {progress && <p>{progress}</p>}
          {error && <p className="ai-error">{error}</p>}
          {busy && <button type="button" className="reset-btn" onClick={cancel}>Cancel</button>}
        </div>
      )}
      <ScenesPanel sourcePath={sourcePath} busy={busy} onMark={markScenes} run={run} />
    </div>
  );
}
