import { UPDATE_CHECK_INTERVAL_MS } from '../../../electron/updates/policy';

interface SettingsDialogProps {
  automatic: boolean;
  crashLogging: boolean;
  onAutomatic: (enabled: boolean) => void;
  onCrashLogging: (enabled: boolean) => void;
  onCheck: () => void;
  onClose: () => void;
}

const HOURS = Math.max(1, Math.round(UPDATE_CHECK_INTERVAL_MS / 3_600_000));

export default function SettingsDialog({
  automatic,
  crashLogging,
  onAutomatic,
  onCrashLogging,
  onCheck,
  onClose,
}: SettingsDialogProps) {
  return (
    <div className="modal-overlay shell-overlay" role="presentation">
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <h2 id="settings-title" className="modal-title">
          Settings
        </h2>
        <label className="setting-row">
          <span>
            <span className="setting-title">Check for updates automatically</span>
            <span className="setting-help">
              On launch, and every {HOURS} hours while EditPro is open.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={automatic}
            onChange={(event) => onAutomatic(event.target.checked)}
            aria-label="Check for updates automatically"
          />
        </label>
        <label className="setting-row">
          <span>
            <span className="setting-title">Save crash logs on this computer</span>
            <span className="setting-help">Nothing is uploaded. Help → Open Log File shows the log.</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={crashLogging}
            onChange={(event) => onCrashLogging(event.target.checked)}
            aria-label="Save crash logs on this computer"
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCheck}>
            Check for updates now
          </button>
          <button type="button" className="btn-primary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
