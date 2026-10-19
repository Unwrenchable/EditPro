import { useState } from 'react';
import { getPlatform } from '../../platform';
import { samplesFromMediaFile } from '../../platform/web/audioSamples';

interface SpeechTranscriptionProps {
  file: File | null;
  disabled?: boolean;
}

/**
 * On-device speech-to-text. Desktop builds explain that Whisper is not bundled.
 * Browsers run Whisper-tiny through transformers.js when that engine is available.
 */
export default function SpeechTranscription({ file, disabled = false }: SpeechTranscriptionProps) {
  const status = getPlatform().featureStatus('whisper');
  const [message, setMessage] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setText('');
    try {
      if (!file) {
        const result = await getPlatform().transcribe({ samples: null });
        setMessage(result.message);
        return;
      }
      const samples = await samplesFromMediaFile(file);
      const result = await getPlatform().transcribe({ samples, sampleRate: 16000 });
      setText(result.text);
      setMessage(result.message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Could not read audio from this file.';
      setMessage(`${status.detail} ${reason}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="info-box speech-transcription">
      <p>{status.summary}</p>
      <button type="button" className="reset-btn" onClick={() => void run()} disabled={disabled || busy}>
        {busy ? 'Transcribing…' : 'Transcribe dialogue'}
      </button>
      {message && <p role="status">{message}</p>}
      {text && <p className="speech-text">{text}</p>}
    </div>
  );
}
