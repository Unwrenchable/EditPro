import React, { useRef, useEffect, useCallback, useState } from 'react';
import { computeWaveform, computeVectorscope } from '../../utils/video/scopes';

type ScopeMode = 'waveform' | 'vectorscope';

interface VideoScopesPanelProps {
  /** The live <video> element to sample frames from. May be null before a file is loaded. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

const WAVEFORM_W  = 256;
const WAVEFORM_H  = 128;
const VECTOR_SIZE = 200;

/**
 * Video Scopes panel: renders a Waveform and Vectorscope from the current
 * video frame by drawing it to a hidden offscreen canvas and analysing the
 * resulting ImageData.
 *
 * The panel updates on each requestAnimationFrame tick while a video is loaded.
 */
const VideoScopesPanel: React.FC<VideoScopesPanelProps> = ({ videoRef }) => {
  const [mode, setMode] = useState<ScopeMode>('waveform');
  const waveCanvasRef   = useRef<HTMLCanvasElement>(null);
  const vectorCanvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef    = useRef<HTMLCanvasElement | null>(null);
  const rafRef          = useRef<number | null>(null);

  // Ensure a stable offscreen canvas exists
  const getOffscreen = useCallback((): HTMLCanvasElement => {
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas');
    }
    return offscreenRef.current;
  }, []);

  const drawWaveform = useCallback((imageData: ImageData) => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const wf = computeWaveform(imageData, WAVEFORM_W);
    ctx.clearRect(0, 0, WAVEFORM_W, WAVEFORM_H);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, WAVEFORM_W, WAVEFORM_H);

    // Draw IRE guides (0%, 50%, 100%)
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    [0, 0.5, 1].forEach((pct) => {
      const y = WAVEFORM_H - pct * WAVEFORM_H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WAVEFORM_W, y);
      ctx.stroke();
    });

    // Draw luma scatter
    const colW = WAVEFORM_W / wf.columns.length;
    wf.columns.forEach((col, xi) => {
      const x = xi * colW;
      col.luma.forEach((luma) => {
        const y = WAVEFORM_H - (luma / 255) * WAVEFORM_H;
        ctx.fillStyle = `rgba(0,230,120,0.35)`;
        ctx.fillRect(x, y, Math.max(1, colW - 0.5), 1);
      });
    });

    // Labels
    ctx.fillStyle = '#888';
    ctx.font = '9px monospace';
    ctx.fillText('100', 2, 10);
    ctx.fillText('50', 2, WAVEFORM_H / 2 + 4);
    ctx.fillText('0', 2, WAVEFORM_H - 2);
  }, []);

  const drawVectorscope = useCallback((imageData: ImageData) => {
    const canvas = vectorCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const vs = computeVectorscope(imageData, 128, 2);
    ctx.clearRect(0, 0, VECTOR_SIZE, VECTOR_SIZE);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, VECTOR_SIZE, VECTOR_SIZE);

    // Crosshair at centre
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(VECTOR_SIZE / 2, 0); ctx.lineTo(VECTOR_SIZE / 2, VECTOR_SIZE);
    ctx.moveTo(0, VECTOR_SIZE / 2); ctx.lineTo(VECTOR_SIZE, VECTOR_SIZE / 2);
    ctx.stroke();

    // Outer circle
    ctx.strokeStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.arc(VECTOR_SIZE / 2, VECTOR_SIZE / 2, VECTOR_SIZE * 0.45, 0, Math.PI * 2);
    ctx.stroke();

    // Find max weight for normalization
    const maxW = vs.points.reduce((m, p) => Math.max(m, p.weight), 1);

    // Draw bucketed points
    vs.points.forEach(({ cb, cr, weight }) => {
      const x = ((cb + 1) / 2) * VECTOR_SIZE;
      const y = VECTOR_SIZE - ((cr + 1) / 2) * VECTOR_SIZE;
      const alpha = Math.min(1, 0.3 + (weight / maxW) * 0.7);
      ctx.fillStyle = `rgba(0,200,255,${alpha.toFixed(2)})`;
      ctx.fillRect(x, y, 2, 2);
    });

    // Axis labels (R, G, B, Y, Cy, Mg colour targets)
    ctx.fillStyle = '#777';
    ctx.font = '8px monospace';
    const half = VECTOR_SIZE / 2;
    const r = VECTOR_SIZE * 0.44;
    const targets: { label: string; angleDeg: number }[] = [
      { label: 'R',  angleDeg: 103 },
      { label: 'Mg', angleDeg: 61  },
      { label: 'B',  angleDeg: 241 },
      { label: 'Cy', angleDeg: 283 },
      { label: 'G',  angleDeg: 167 },
      { label: 'Yl', angleDeg: 13  },
    ];
    targets.forEach(({ label, angleDeg }) => {
      const rad = (angleDeg * Math.PI) / 180;
      ctx.fillText(label, half + Math.cos(rad) * r - 4, half - Math.sin(rad) * r + 4);
    });
  }, []);

  const captureAndDraw = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    const offscreen = getOffscreen();
    const sampleW = Math.min(video.videoWidth  || 320, 320);
    const sampleH = Math.min(video.videoHeight || 180, 180);
    if (offscreen.width !== sampleW)  offscreen.width  = sampleW;
    if (offscreen.height !== sampleH) offscreen.height = sampleH;

    const ctx = offscreen.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, sampleW, sampleH);
    const imageData = ctx.getImageData(0, 0, sampleW, sampleH);

    if (mode === 'waveform') drawWaveform(imageData);
    else drawVectorscope(imageData);
  }, [videoRef, getOffscreen, mode, drawWaveform, drawVectorscope]);

  // RAF loop — only run while the panel is mounted and video exists
  useEffect(() => {
    let alive = true;

    const loop = () => {
      if (!alive) return;
      captureAndDraw();
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [captureAndDraw]);

  return (
    <div className="video-scopes-panel" aria-label="Video scopes">
      <div className="scopes-header">
        <span className="scopes-title">Scopes</span>
        <div className="scopes-mode-tabs" role="tablist" aria-label="Scope mode">
          <button
            role="tab"
            aria-selected={mode === 'waveform'}
            className={`scope-tab${mode === 'waveform' ? ' active' : ''}`}
            onClick={() => setMode('waveform')}
            aria-label="Waveform scope"
          >
            Waveform
          </button>
          <button
            role="tab"
            aria-selected={mode === 'vectorscope'}
            className={`scope-tab${mode === 'vectorscope' ? ' active' : ''}`}
            onClick={() => setMode('vectorscope')}
            aria-label="Vectorscope"
          >
            Vectorscope
          </button>
        </div>
      </div>

      <div className="scopes-canvas-area">
        {mode === 'waveform' ? (
          <canvas
            ref={waveCanvasRef}
            width={WAVEFORM_W}
            height={WAVEFORM_H}
            className="scope-canvas"
            aria-label="Waveform display"
          />
        ) : (
          <canvas
            ref={vectorCanvasRef}
            width={VECTOR_SIZE}
            height={VECTOR_SIZE}
            className="scope-canvas"
            aria-label="Vectorscope display"
          />
        )}
      </div>
    </div>
  );
};

export default VideoScopesPanel;
