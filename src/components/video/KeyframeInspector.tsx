import React from 'react';
import type { ClipKeyframe, EaseCurve, KeyframeProperty } from '../../types';
import { formatTime } from '../../utils/videoUtils';

const PROPERTIES: { id: KeyframeProperty; label: string }[] = [
  { id: 'positionX', label: 'Pos X' },
  { id: 'positionY', label: 'Pos Y' },
  { id: 'scale', label: 'Scale' },
  { id: 'rotation', label: 'Rotate' },
  { id: 'opacity', label: 'Opacity' },
  { id: 'effect', label: 'Effect' },
];

const EASINGS: { id: EaseCurve; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease in' },
  { id: 'easeOut', label: 'Ease out' },
  { id: 'easeInOut', label: 'Ease in-out' },
  { id: 'hold', label: 'Hold' },
];

interface KeyframeInspectorProps {
  targetLabel: string;
  keyframes: readonly ClipKeyframe[];
  property: KeyframeProperty;
  effectParam: string;
  easing: EaseCurve;
  selectedKeyframeId: string | null;
  onPropertyChange: (property: KeyframeProperty) => void;
  onEffectParamChange: (effectParam: string) => void;
  onEasingChange: (easing: EaseCurve) => void;
  onSelectKeyframe: (keyframeId: string | null) => void;
  onAdd: () => void;
  onChangeValue: (keyframeId: string, value: number, coalesce: boolean) => void;
  onChangeEasing: (keyframeId: string, easing: EaseCurve) => void;
  onRemove: (keyframeId: string) => void;
}

const KeyframeInspector: React.FC<KeyframeInspectorProps> = ({
  targetLabel,
  keyframes,
  property,
  effectParam,
  easing,
  selectedKeyframeId,
  onPropertyChange,
  onEffectParamChange,
  onEasingChange,
  onSelectKeyframe,
  onAdd,
  onChangeValue,
  onChangeEasing,
  onRemove,
}) => {
  const visible = keyframes.filter((keyframe) =>
    property === 'effect' ? keyframe.property === 'effect' && keyframe.effectParam === effectParam : keyframe.property === property,
  );
  const selected = visible.find((keyframe) => keyframe.id === selectedKeyframeId) ?? null;

  return (
    <div className="tl-kf-inspector" aria-label="Keyframe inspector">
      <div className="tl-kf-row">
        <span className="tl-kf-target">{targetLabel}</span>
        {PROPERTIES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tl-tool-btn${property === item.id ? ' active' : ''}`}
            aria-pressed={property === item.id}
            onClick={() => onPropertyChange(item.id)}
          >
            {item.label}
          </button>
        ))}
        {property === 'effect' && (
          <input
            className="tl-kf-param"
            aria-label="Effect parameter"
            value={effectParam}
            onChange={(event) => onEffectParamChange(event.target.value)}
            placeholder="blur"
          />
        )}
        <label className="tl-kf-ease">
          Easing
          <select
            aria-label="Keyframe easing"
            value={selected?.easing ?? easing}
            onChange={(event) => {
              const next = event.target.value as EaseCurve;
              onEasingChange(next);
              if (selected) onChangeEasing(selected.id, next);
            }}
          >
            {EASINGS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <button type="button" className="tl-tool-btn" onClick={onAdd} aria-label="Add keyframe at playhead">
          + Keyframe
        </button>
      </div>
      {selected && (
        <div className="tl-kf-row">
          <label className="tl-kf-value">
            {formatTime(selected.time)}
            <input
              type="range"
              min={property === 'opacity' ? 0 : property === 'scale' ? 0.01 : property === 'effect' ? 0 : -2}
              max={property === 'opacity' ? 1 : property === 'rotation' ? 360 : property === 'scale' ? 4 : property === 'effect' ? 100 : 2}
              step={property === 'rotation' ? 1 : 0.01}
              value={selected.value}
              aria-label="Keyframe value"
              onChange={(event) => onChangeValue(selected.id, Number(event.target.value), true)}
            />
          </label>
          <span className="tl-kf-readout">{selected.value.toFixed(2)}</span>
          <button type="button" className="tl-tool-btn" onClick={() => onRemove(selected.id)} aria-label="Delete keyframe">
            Delete key
          </button>
        </div>
      )}
      {visible.length > 0 && (
        <div className="tl-kf-list">
          {visible.map((keyframe) => (
            <button
              key={keyframe.id}
              type="button"
              className={`tl-kf-chip${keyframe.id === selected?.id ? ' active' : ''}`}
              onClick={() => onSelectKeyframe(keyframe.id)}
            >
              {formatTime(keyframe.time)} · {keyframe.value.toFixed(2)} · {keyframe.easing}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default KeyframeInspector;
