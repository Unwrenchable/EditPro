import { useCallback, useEffect, useState } from 'react';
import { useEditorSession } from '../../../session/editorSessionContext';
import type { AiModelStatus } from '../../../types/electron';
import BackgroundPanel from './BackgroundPanel';
import { useAiTask } from './useAiTask';

export default function OfflineAiPanel() {
  const { video } = useEditorSession();
  const sourcePath = video.state.mediaPath;
  const { busy, progress, error, setError, run, cancel } = useAiTask();
  const [matte, setMatte] = useState<AiModelStatus | null>(null);
  const desktop = Boolean(window.editpro?.aiRemoveBackground);

  const refresh = useCallback(async () => {
    const bridge = window.editpro;
    if (!bridge?.aiStatus) return;
    try {
      const status = await bridge.aiStatus();
      setMatte(status.matte);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the matting model');
    }
  }, [setError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="ai-tools">
      <div className="info-box">
        Background removal runs a local portrait matte. The model downloads once and then works offline. Transparent output is WebM with alpha.
      </div>
      {!desktop && <p className="panel-hint ai-hint">Background removal runs in the desktop app.</p>}
      {desktop && !sourcePath && (
        <p className="panel-hint ai-hint">Open a video from disk. A browser-only preview has no file to matte.</p>
      )}
      {(progress || error) && (
        <div className="ai-status">
          {progress && <p>{progress}</p>}
          {error && <p className="ai-error">{error}</p>}
          {busy && <button type="button" className="reset-btn" onClick={cancel}>Cancel</button>}
        </div>
      )}
      <BackgroundPanel sourcePath={sourcePath} busy={busy} matte={matte} onRefresh={refresh} run={run} />
    </div>
  );
}
