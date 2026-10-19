import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import SpeechTranscription from '../components/video/SpeechTranscription';
import { resetBrowserPlatformForTests } from '../platform';

describe('SpeechTranscription', () => {
  beforeEach(() => {
    resetBrowserPlatformForTests();
    delete window.editpro;
  });

  it('explains that Whisper is not running in this session', async () => {
    render(<SpeechTranscription file={null} />);
    expect(screen.getByText(/not available in this session/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe dialogue' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/transformers\.js|Whisper/i);
  });
});
