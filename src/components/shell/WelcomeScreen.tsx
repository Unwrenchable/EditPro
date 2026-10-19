import { useState } from 'react';
import { UPDATE_CHECK_INTERVAL_MS } from '../../../electron/updates/policy';

interface WelcomeScreenProps {
  version: string | null;
  onStart: (crashLogging: boolean) => void;
}

const HOURS = Math.max(1, Math.round(UPDATE_CHECK_INTERVAL_MS / 3_600_000));

const cards = [
  {
    title: 'Adjust a photo',
    copy: 'Light, color, and detail, then export a finished still.',
  },
  {
    title: 'Cut a video',
    copy: 'Trim, grade, and deliver the timeline you see in the viewer.',
  },
  {
    title: 'Make a Magic Movie',
    copy: 'Hand EditPro a set of clips and start from a cut.',
  },
];

export default function WelcomeScreen({ version, onStart }: WelcomeScreenProps) {
  const [crashLogging, setCrashLogging] = useState(false);
  return (
    <div className="modal-overlay welcome-overlay" role="presentation">
      <div
        className="modal welcome-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
      >
        <p className="welcome-kicker">EditPro{version ? ` ${version}` : ''}</p>
        <h2 id="welcome-title" className="modal-title welcome-title">
          Welcome to EditPro
        </h2>
        <p className="modal-copy">
          A photo and video editor for the cut in front of you. Open a file, make the picture, and export.
        </p>
        <div className="welcome-grid">
          {cards.map((card) => (
            <section key={card.title} className="welcome-card">
              <h3>{card.title}</h3>
              <p>{card.copy}</p>
            </section>
          ))}
        </div>
        <p className="modal-copy welcome-note">
          EditPro looks for updates when it opens, and every {HOURS} hours after that. You can turn automatic checks
          off in Settings.
        </p>
        <label className="setting-row welcome-log">
          <span>
            <span className="setting-title">Save a local crash log</span>
            <span className="setting-help">Errors stay on this computer. Open the file later from Help.</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={crashLogging}
            onChange={(event) => setCrashLogging(event.target.checked)}
            aria-label="Save a local crash log"
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={() => onStart(crashLogging)} autoFocus>
            Get started
          </button>
        </div>
      </div>
    </div>
  );
}
