import React from 'react';
import { placeMotion, type MotionDocument } from '../../utils/video/motionGraphics';

interface MotionStageProps {
  document: MotionDocument;
  currentTime: number;
}

/** Program-monitor drawing for animated text and shapes. */
const MotionStage: React.FC<MotionStageProps> = ({ document, currentTime }) => {
  const shapes = document.shapes
    .map((shape) => ({ shape, place: placeMotion(shape, currentTime) }))
    .filter((item): item is { shape: typeof item.shape; place: NonNullable<typeof item.place> } => item.place !== null && item.place.opacity > 0.001);
  const texts = document.texts
    .map((text) => ({ text, place: placeMotion({ ...text, width: 0.2, height: text.fontSize / 100 }, currentTime) }))
    .filter((item): item is { text: typeof item.text; place: NonNullable<typeof item.place> } => item.place !== null && item.place.opacity > 0.001);
  if (shapes.length === 0 && texts.length === 0) return null;
  return (
    <svg className="motion-stage" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {shapes.map(({ shape, place }) => {
        const transform = `rotate(${place.rotation} ${place.x * 100 + (place.width * place.scale * 100) / 2} ${place.y * 100 + (place.height * place.scale * 100) / 2})`;
        if (shape.kind === 'ellipse') {
          return (
            <ellipse
              key={shape.id}
              cx={place.x * 100 + (place.width * place.scale * 100) / 2}
              cy={place.y * 100 + (place.height * place.scale * 100) / 2}
              rx={(place.width * place.scale * 100) / 2}
              ry={(place.height * place.scale * 100) / 2}
              fill={shape.fill}
              stroke={shape.stroke}
              strokeWidth={shape.strokeWidth / 10}
              opacity={place.opacity}
              transform={transform}
            />
          );
        }
        if (shape.kind === 'line') {
          return (
            <line
              key={shape.id}
              x1={place.x * 100}
              y1={place.y * 100}
              x2={(place.x + place.width * place.scale) * 100}
              y2={place.y * 100}
              stroke={shape.fill}
              strokeWidth={Math.max(0.4, shape.strokeWidth / 8)}
              opacity={place.opacity}
            />
          );
        }
        return (
          <rect
            key={shape.id}
            x={place.x * 100}
            y={place.y * 100}
            width={place.width * place.scale * 100}
            height={place.height * place.scale * 100}
            fill={shape.fill}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth / 10}
            opacity={place.opacity}
            transform={transform}
          />
        );
      })}
      {texts.map(({ text, place }) => (
        <text
          key={text.id}
          x={place.x * 100}
          y={place.y * 100}
          fill={text.color}
          opacity={place.opacity}
          fontFamily={text.fontFamily}
          fontSize={text.fontSize * place.scale}
          textAnchor={text.align === 'center' ? 'middle' : text.align === 'right' ? 'end' : 'start'}
          dominantBaseline="middle"
          transform={`rotate(${place.rotation} ${place.x * 100} ${place.y * 100})`}
        >
          {text.text}
        </text>
      ))}
    </svg>
  );
};

export default MotionStage;
