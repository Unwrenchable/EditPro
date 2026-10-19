import AboutDialog from './AboutDialog';
import SettingsDialog from './SettingsDialog';
import UpdateNotification from './UpdateNotification';
import WelcomeScreen from './WelcomeScreen';
import { useEditorSession } from '../../session/editorSessionContext';
import { useDesktopChrome } from '../../hooks/useDesktopChrome';

function RecoveryDialog() {
  const { recovery, restoreRecovery, discardRecovery } = useEditorSession();
  if (!recovery) return null;
  const when = recovery.savedAt ? new Date(recovery.savedAt).toLocaleString() : null;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Restore autosave">
      <div className="modal">
        <h2 className="modal-title">Restore unsaved work?</h2>
        <p className="modal-copy">
          {recovery.kind === 'crash'
            ? 'EditPro did not shut down cleanly. An autosave of your project is available.'
            : 'You have unsaved changes from the last session.'}
          {when ? ` Autosaved ${when}.` : ''}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={() => void discardRecovery()}>
            Discard
          </button>
          <button type="button" className="btn-primary" onClick={() => void restoreRecovery()}>
            Restore
          </button>
        </div>
      </div>
    </div>
  );
}

/** First-run welcome, settings, about, update prompts, and crash recovery. */
export default function AppChrome() {
  const chrome = useDesktopChrome();
  return (
    <>
      {chrome.showWelcome && (
        <WelcomeScreen version={chrome.version} onStart={(crashLogging) => void chrome.completeOnboarding(crashLogging)} />
      )}
      {chrome.prefs?.onboardingComplete && <RecoveryDialog />}
      {chrome.settingsOpen && chrome.prefs && (
        <SettingsDialog
          automatic={chrome.prefs.automaticUpdateChecks}
          crashLogging={chrome.prefs.crashLogging}
          onAutomatic={(enabled) => void chrome.setAutomatic(enabled)}
          onCrashLogging={(enabled) => void chrome.setCrashLogging(enabled)}
          onCheck={chrome.checkForUpdates}
          onClose={() => chrome.setSettingsOpen(false)}
        />
      )}
      {chrome.aboutOpen && (
        <AboutDialog
          version={chrome.version}
          onClose={() => chrome.setAboutOpen(false)}
          onOpenWebsite={() => void chrome.openWebsite()}
        />
      )}
      {chrome.dialog.type !== 'hidden' && (
        <UpdateNotification
          state={chrome.dialog}
          onDownload={chrome.downloadUpdate}
          onInstall={chrome.installUpdate}
          onOpenRelease={() => void chrome.openRelease()}
          onRemind={chrome.remindLater}
          onSkip={chrome.skipUpdate}
          onClose={chrome.dismissUpdate}
          onRetry={chrome.checkForUpdates}
        />
      )}
    </>
  );
}
