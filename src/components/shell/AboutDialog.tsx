interface AboutDialogProps {
  version: string | null;
  onClose: () => void;
  onOpenWebsite: () => void;
}

export default function AboutDialog({ version, onClose, onOpenWebsite }: AboutDialogProps) {
  return (
    <div className="modal-overlay shell-overlay" role="presentation">
      <div className="modal about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <p className="welcome-kicker">Photo and video</p>
        <h2 id="about-title" className="modal-title">
          About EditPro
        </h2>
        <p className="about-version">{version ? `Version ${version}` : 'Version unavailable'}</p>
        <p className="modal-copy">
          Professional photo and video editing for macOS, Windows, and Linux.
        </p>
        <p className="modal-copy">Copyright © 2026 Jax Harlan</p>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onOpenWebsite}>
            View on GitHub
          </button>
          <button type="button" className="btn-primary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
