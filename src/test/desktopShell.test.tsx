import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import AboutDialog from '../components/shell/AboutDialog';
import SettingsDialog from '../components/shell/SettingsDialog';
import UpdateNotification from '../components/shell/UpdateNotification';
import WelcomeScreen from '../components/shell/WelcomeScreen';
import { resetPageBootToken } from '../services/projectIO';
import type { UpdateDialogState } from '../../electron/updates/policy';

const update: Extract<UpdateDialogState, { type: 'available' }> = {
  type: 'available',
  source: 'automatic',
  downloaded: false,
  progress: null,
  error: null,
  update: {
    version: '1.2.0',
    releaseName: 'EditPro 1.2.0',
    notes: 'Steadier playback.',
    releaseUrl: 'https://github.com/Unwrenchable/EditPro/releases/tag/v1.2.0',
    canAutoInstall: true,
  },
};

describe('WelcomeScreen', () => {
  it('finishes onboarding and reports the crash-log choice', () => {
    const onStart = vi.fn();
    render(<WelcomeScreen version="1.0.0" onStart={onStart} />);
    expect(screen.getByRole('dialog', { name: 'Welcome to EditPro' })).toBeInTheDocument();
    expect(screen.getByText(/every 4 hours/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Save a local crash log' }));
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(onStart).toHaveBeenCalledWith(true);
  });
});

describe('SettingsDialog', () => {
  it('toggles automatic checks and crash logs, and can check now', () => {
    const onAutomatic = vi.fn();
    const onCrashLogging = vi.fn();
    const onCheck = vi.fn();
    render(
      <SettingsDialog
        automatic
        crashLogging={false}
        onAutomatic={onAutomatic}
        onCrashLogging={onCrashLogging}
        onCheck={onCheck}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Check for updates automatically' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Save crash logs on this computer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates now' }));
    expect(onAutomatic).toHaveBeenCalledWith(false);
    expect(onCrashLogging).toHaveBeenCalledWith(true);
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/every 4 hours/i)).toBeInTheDocument();
  });
});

describe('AboutDialog', () => {
  it('shows the version and opens the project page', () => {
    const onOpenWebsite = vi.fn();
    render(<AboutDialog version="1.0.0" onClose={() => undefined} onOpenWebsite={onOpenWebsite} />);
    expect(screen.getByText('Version 1.0.0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View on GitHub' }));
    expect(onOpenWebsite).toHaveBeenCalledTimes(1);
  });
});

describe('UpdateNotification', () => {
  it('offers install, the release page, remind, and skip', () => {
    const onDownload = vi.fn();
    const onOpenRelease = vi.fn();
    const onRemind = vi.fn();
    const onSkip = vi.fn();
    render(
      <UpdateNotification
        state={update}
        onDownload={onDownload}
        onInstall={() => undefined}
        onOpenRelease={onOpenRelease}
        onRemind={onRemind}
        onSkip={onSkip}
        onClose={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'EditPro 1.2.0' })).toBeInTheDocument();
    expect(screen.getByText('Steadier playback.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download & install' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download from the website' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remind me later' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip this version' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onOpenRelease).toHaveBeenCalledTimes(1);
    expect(onRemind).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('shows progress and then a restart action', () => {
    const onInstall = vi.fn();
    const { rerender } = render(
      <UpdateNotification
        state={{ ...update, progress: { percent: 40, transferred: 4_000_000, total: 10_000_000 } }}
        onDownload={() => undefined}
        onInstall={onInstall}
        onOpenRelease={() => undefined}
        onRemind={() => undefined}
        onSkip={() => undefined}
        onClose={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole('progressbar', { name: 'Download progress' })).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText(/Downloading… 40%/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip this version' })).not.toBeInTheDocument();

    rerender(
      <UpdateNotification
        state={{ ...update, downloaded: true, progress: null }}
        onDownload={() => undefined}
        onInstall={onInstall}
        onOpenRelease={() => undefined}
        onRemind={() => undefined}
        onSkip={() => undefined}
        onClose={() => undefined}
        onRetry={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('hides in-app install when this copy cannot apply the update', () => {
    render(
      <UpdateNotification
        state={{ ...update, update: { ...update.update, canAutoInstall: false } }}
        onDownload={() => undefined}
        onInstall={() => undefined}
        onOpenRelease={() => undefined}
        onRemind={() => undefined}
        onSkip={() => undefined}
        onClose={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Download & install' })).not.toBeInTheDocument();
    expect(screen.getByText(/Download the release from the website/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download from the website' })).toBeInTheDocument();
  });

  it('reports the current version and a failed check', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <UpdateNotification
        state={{ type: 'up-to-date', version: '1.0.0' }}
        onDownload={() => undefined}
        onInstall={() => undefined}
        onOpenRelease={() => undefined}
        onRemind={() => undefined}
        onSkip={() => undefined}
        onClose={() => undefined}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('EditPro 1.0.0 is the latest version.')).toBeInTheDocument();
    rerender(
      <UpdateNotification
        state={{ type: 'error', message: 'GitHub rate limit reached. Try again later.' }}
        onDownload={() => undefined}
        onInstall={() => undefined}
        onOpenRelease={() => undefined}
        onRemind={() => undefined}
        onSkip={() => undefined}
        onClose={() => undefined}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('first-run welcome in the app', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPageBootToken();
  });

  it('stays up until Get started, then remembers that choice', () => {
    const { unmount } = render(<App />);
    expect(screen.getByRole('dialog', { name: 'Welcome to EditPro' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Save a local crash log' }));
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(screen.queryByRole('dialog', { name: 'Welcome to EditPro' })).not.toBeInTheDocument();
    unmount();

    render(<App />);
    expect(screen.queryByRole('dialog', { name: 'Welcome to EditPro' })).not.toBeInTheDocument();
    expect(localStorage.getItem('editpro.preferences.v1')).toContain('"onboardingComplete":true');
    expect(localStorage.getItem('editpro.preferences.v1')).toContain('"crashLogging":true');
  });
});
