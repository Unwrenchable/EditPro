import type { UpdateDialogState } from '../../../electron/updates/policy';

type VisibleUpdate = Exclude<UpdateDialogState, { type: 'hidden' }>;

interface UpdateNotificationProps {
  state: VisibleUpdate;
  onDownload: () => void;
  onInstall: () => void;
  onOpenRelease: () => void;
  onRemind: () => void;
  onSkip: () => void;
  onClose: () => void;
  onRetry: () => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UpdateNotification({
  state,
  onDownload,
  onInstall,
  onOpenRelease,
  onRemind,
  onSkip,
  onClose,
  onRetry,
}: UpdateNotificationProps) {
  if (state.type === 'checking') {
    return (
      <div className="modal-overlay update-overlay" role="presentation">
        <div className="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-title" aria-busy="true">
          <h2 id="update-title" className="modal-title">
            Checking for updates…
          </h2>
          <p className="modal-copy">Looking at the latest EditPro release.</p>
        </div>
      </div>
    );
  }

  if (state.type === 'up-to-date') {
    return (
      <div className="modal-overlay update-overlay" role="presentation">
        <div className="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-title">
          <h2 id="update-title" className="modal-title">
            You&apos;re up to date
          </h2>
          <p className="modal-copy">EditPro {state.version} is the latest version.</p>
          <div className="modal-actions">
            <button type="button" className="btn-primary" onClick={onClose} autoFocus>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.type === 'error') {
    return (
      <div className="modal-overlay update-overlay" role="presentation">
        <div className="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-title">
          <h2 id="update-title" className="modal-title">
            Couldn&apos;t check for updates
          </h2>
          <p className="export-error" role="alert">
            {state.message}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Close
            </button>
            <button type="button" className="btn-primary" onClick={onRetry} autoFocus>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const downloading = state.progress != null && !state.downloaded;
  const percent = state.progress?.percent ?? 0;
  return (
    <div className="modal-overlay update-overlay" role="presentation">
      <div className="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <p className="welcome-kicker">Update available</p>
        <h2 id="update-title" className="modal-title">
          EditPro {state.update.version}
        </h2>
        <p className="modal-copy">{state.update.releaseName}</p>
        <p className="modal-copy">
          {state.update.canAutoInstall
            ? 'Download the update, then restart EditPro to finish installing it.'
            : 'Automatic install isn\u2019t available for this copy. Download the release from the website and install it yourself.'}
        </p>
        <div className="update-notes" tabIndex={0}>
          {state.update.notes || 'No release notes were published for this version.'}
        </div>
        {downloading && state.progress && (
          <div className="export-progress-block">
            <div
              className="export-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label="Download progress"
            >
              <div className="export-progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="export-progress-label">
              Downloading… {percent}% ({formatBytes(state.progress.transferred)} of {formatBytes(state.progress.total)})
            </p>
          </div>
        )}
        {state.error && (
          <p className="export-error" role="alert">
            {state.error}
          </p>
        )}
        <div className="modal-actions update-actions">
          {!downloading && (
            <div className="update-actions-quiet">
              <button type="button" className="btn-secondary" onClick={onRemind}>
                Remind me later
              </button>
              <button type="button" className="btn-secondary" onClick={onSkip}>
                Skip this version
              </button>
            </div>
          )}
          <button type="button" className="btn-secondary" onClick={onOpenRelease}>
            Download from the website
          </button>
          {state.update.canAutoInstall && !state.downloaded && (
            <button type="button" className="btn-primary" onClick={onDownload} disabled={downloading} autoFocus>
              {downloading ? 'Downloading…' : 'Download & install'}
            </button>
          )}
          {state.update.canAutoInstall && state.downloaded && (
            <button type="button" className="btn-primary" onClick={onInstall} autoFocus>
              Restart to update
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
