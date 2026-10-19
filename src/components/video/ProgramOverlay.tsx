import React, { useEffect, useRef } from 'react';
import type { TimelineClip, VideoTransition } from '../../types';
import {
  activeTransitionAt,
  applyGrade,
  curvesAreNeutral,
  edgePresentation,
  liftGammaGainIsNeutral,
  titlePlacement,
  transitionFrame,
  type CreativeState,
} from '../../utils/video/creative';
import { transitionDuration } from '../../utils/video/exportPlan';

interface ProgramOverlayProps {
  creative: CreativeState;
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  playbackRate: number;
  transition: VideoTransition;
  clips: TimelineClip[];
  /** CSS filter already used for Lumetri, reapplied when the grade canvas samples the frame. */
  lumetriFilter: string;
  /** Keyframed position, scale, rotation, and opacity. Shared by the video and the grade canvas. */
  pictureStyle?: React.CSSProperties;
  /** Keyframed blur, brightness, contrast, and saturation, drawn on top of the graded canvas. */
  canvasFilter?: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** GPU compositor is covering the element, so the raw frame stays invisible. */
  gpuActive?: boolean;
  previewCanvas?: React.ReactNode;
  children: React.ReactNode;
}

function edgeCss(edge: ReturnType<typeof edgePresentation>): React.CSSProperties {
  const clip = edge.visibleWidth < 0.999
    ? `inset(0 ${(1 - edge.visibleWidth) * 100}% 0 0)`
    : undefined;
  const transform = `translateX(${(edge.translateX * 100).toFixed(2)}%) scale(${edge.scale.toFixed(4)})`;
  return {
    opacity: edge.opacity,
    transform,
    transformOrigin: 'center center',
    clipPath: clip,
  };
}

/**
 * Program monitor treatment shared with the encoder: edge fades, titles,
 * between-clip transitions, and the lift/gamma/gain + LUT grade.
 */
const ProgramOverlay: React.FC<ProgramOverlayProps> = ({
  creative,
  currentTime,
  trimStart,
  trimEnd,
  playbackRate,
  transition,
  clips,
  lumetriFilter,
  pictureStyle,
  canvasFilter,
  videoRef,
  gpuActive = false,
  previewCanvas = null,
  children,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rate = playbackRate > 0 ? playbackRate : 1;
  const outputDuration = Math.max(0, (trimEnd - trimStart) / rate);
  const outputTime = (currentTime - trimStart) / rate;
  const edge = edgePresentation(transition, outputTime, outputDuration, transitionDuration(outputDuration));
  const gradeActive = !liftGammaGainIsNeutral(creative.liftGammaGain)
    || creative.lut !== null
    || !curvesAreNeutral(creative.curves)
    || (creative.hdr.toneMapPreview && creative.hdr.transfer !== 'sdr');
  const cut = activeTransitionAt(clips, creative.transitions, currentTime);
  const frame = cut ? transitionFrame(cut.transition.kind, cut.progress) : null;

  useEffect(() => {
    if (!gradeActive) return;
    let handle = 0;
    const draw = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2 && video.videoWidth > 0) {
        const scale = Math.min(1, 480 / video.videoWidth);
        const width = Math.max(2, Math.round(video.videoWidth * scale));
        const height = Math.max(2, Math.round(video.videoHeight * scale));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.filter = lumetriFilter && lumetriFilter !== 'none' ? lumetriFilter : 'none';
          ctx.drawImage(video, 0, 0, width, height);
          ctx.filter = 'none';
          const image = ctx.getImageData(0, 0, width, height);
          const pixels = image.data;
          for (let index = 0; index < pixels.length; index += 4) {
            const graded = applyGrade(
              { r: pixels[index] / 255, g: pixels[index + 1] / 255, b: pixels[index + 2] / 255 },
              creative.liftGammaGain,
              creative.lut,
              creative.curves,
              creative.lutStrength,
              creative.hdr,
            );
            pixels[index] = Math.round(graded.r * 255);
            pixels[index + 1] = Math.round(graded.g * 255);
            pixels[index + 2] = Math.round(graded.b * 255);
          }
          ctx.putImageData(image, 0, 0);
        }
      }
      handle = window.requestAnimationFrame(draw);
    };
    handle = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(handle);
  }, [gradeActive, lumetriFilter, creative.liftGammaGain, creative.lut, creative.curves, creative.lutStrength, creative.hdr, videoRef]);

  const titles = creative.titles
    .map((title) => ({ title, place: titlePlacement(title, currentTime) }))
    .filter((item): item is { title: typeof item.title; place: NonNullable<typeof item.place> } => item.place !== null && item.place.opacity > 0.001);

  return (
    <div className="program-monitor" style={edgeCss(edge)}>
      <div
        className={[
          gradeActive ? 'program-video-graded program-picture' : 'program-picture',
          gpuActive ? 'program-picture-gpu' : '',
        ].filter(Boolean).join(' ')}
        style={pictureStyle}
      >
        {children}
        {previewCanvas}
        {gradeActive && (
          <canvas
            ref={canvasRef}
            className="grade-canvas"
            style={canvasFilter ? { filter: canvasFilter } : undefined}
            aria-hidden="true"
          />
        )}
      </div>
      {frame && frame.veil > 0.001 && frame.veilColor && (
        <div
          className="transition-veil"
          style={{ background: frame.veilColor, opacity: frame.veil }}
          aria-hidden="true"
        />
      )}
      {frame && frame.outgoingVisible < 0.999 && (
        <div
          className="transition-veil"
          style={{
            background: '#000',
            clipPath: frame.axis === 'y'
              ? `inset(${frame.direction < 0 ? 0 : (1 - frame.outgoingVisible) * 100}% 0 ${frame.direction < 0 ? (1 - frame.outgoingVisible) * 100 : 0}% 0)`
              : `inset(0 ${frame.direction > 0 ? (1 - frame.outgoingVisible) * 100 : 0}% 0 ${frame.direction < 0 ? (1 - frame.outgoingVisible) * 100 : 0}%)`,
          }}
          aria-hidden="true"
        />
      )}
      {titles.map(({ title, place }) => (
        <div
          key={title.id}
          className={`program-title program-title-${place.align}`}
          style={{
            left: `${place.x * 100}%`,
            top: `${place.y * 100}%`,
            opacity: place.opacity,
            color: place.color,
            fontFamily: place.fontFamily,
            fontSize: `${place.fontSize * 100}cqh`,
            WebkitTextStroke: place.strokeWidth > 0 ? `${place.strokeWidth * 100}cqh ${place.strokeColor}` : undefined,
            textShadow: place.shadowBlur > 0 || place.shadowOffsetX !== 0 || place.shadowOffsetY !== 0
              ? `${place.shadowOffsetX * 100}cqh ${place.shadowOffsetY * 100}cqh ${place.shadowBlur * 100}cqh ${place.shadowColor}`
              : undefined,
          }}
        >
          {place.text}
        </div>
      ))}
    </div>
  );
};

export default ProgramOverlay;
