import React, { useEffect, useRef } from 'react';

interface WaveformViewProps {
  peaks: readonly number[];
  width: number;
  height: number;
}

/** Draws peak bars for one timeline clip. Peaks are 0–1 amplitudes from {@link waveformPeaks}. */
const WaveformView: React.FC<WaveformViewProps> = ({ peaks, width, height }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (peaks.length === 0) return;
    ctx.fillStyle = 'rgba(126, 196, 255, 0.9)';
    const mid = h / 2;
    const barWidth = Math.max(1, w / peaks.length);
    peaks.forEach((peak, index) => {
      const bar = Math.max(1, Math.min(1, peak) * (h - 2));
      ctx.fillRect(index * barWidth, mid - bar / 2, Math.max(1, barWidth - 0.4), bar);
    });
  }, [peaks, width, height]);

  return <canvas ref={ref} className="tl-waveform" aria-hidden="true" />;
};

export default WaveformView;
