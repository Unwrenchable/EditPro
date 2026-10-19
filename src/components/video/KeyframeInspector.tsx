import React from 'react';
import type { ClipKeyframe, EaseCurve, KeyframeProperty } from '../../types';
import { DEFAULT_BEZIER } from '../../../electron/export/easing';
import { formatTime } from '../../utils/videoUtils';
import {
  ANIMATABLE_CHANNELS,
  channelId,
  findChannel,
  type KeyframePatch,
} from '../../utils/video/keyframes';

const EASINGS: { id: EaseCurve; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease in' },
  { id: 'easeOut', label: 'Ease out' },
  { id: 'easeInOut', label: 'Ease in-out' },
  { id: 'hold', label: 'Hold' },
  { id: 'bezier', label: 'Bezier' },
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
  onPatch: (keyframeId: string, patch: KeyframePatch, coalesceKey?: string) => void;
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
  onPatch,
  onRemove,
}) => {
  const visible = keyframes.filter((keyframe) =>
    property === 'effect' ? keyframe.property === 'effect' && keyframe.effectParam === effectParam : keyframe.property === property,
  );
  const selected = visible.find((keyframe) => keyframe.id === selectedKeyframeId) ?? null;
  const known = findChannel(property, property === 'effect' ? effectParam : undefined);
  const range = known ?? { min: property === 'opacity' ? 0 : -2, max: property === 'opacity' ? 1 : 2, step: 0.01 };
  const extraParams = [...new Set(
    keyframes
      .filter((keyframe) => keyframe.property === 'effect' && keyframe.effectParam && !findChannel('effect', keyframe.effectParam))
      .map((keyframe) => keyframe.effectParam as string),
  )];
  const selectedChannel = property === 'effect' ? `effect:${effectParam}` : property;
  const handles = selected?.bezier ?? DEFAULT_BEZIER;

  const chooseChannel = (id: string) => {
    const channel = ANIMATABLE_CHANNELS.find((item) => item.id === id);
    if (channel) {
      onPropertyChange(channel.property);
      if (channel.effectParam) onEffectParamChange(channel.effectParam);
      return;
    }
    if (id.startsWith('effect:')) {
      onPropertyChange('effect');
      onEffectParamChange(id.slice('effect:'.length));
    }
  };

  return (
    <div className="tl-kf-inspector" aria-label="Keyframe inspector">
      <div className="tl-kf-row">
        <span className="tl-kf-target">{targetLabel}</span>
        <label className="tl-kf-ease">
          Property
          <select
            aria-label="Animated property"
            value={ANIMATABLE_CHANNELS.some((item) => item.id === selectedChannel) || extraParams.includes(effectParam) ? selectedChannel : channelId(property, effectParam)}
            onChange={(event) => chooseChannel(event.target.value)}
          >
            {ANIMATABLE_CHANNELS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
            {extraParams.map((param) => (
              <option key={param} value={`effect:${param}`}>{param}</option>
            ))}
          </select>
        </label>
        {property === 'effect' && !known && (
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
              if (!selected) return;
              onPatch(
                selected.id,
                next === 'bezier'
                  ? { easing: next, bezier: selected.bezier ?? { ...DEFAULT_BEZIER } }
                  : { easing: next, bezier: undefined },
              );
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
              min={range.min}
              max={range.max}
              step={range.step}
              value={selected.value}
              aria-label="Keyframe value"
              onChange={(event) => onPatch(selected.id, { value: Number(event.target.value) }, `kf-value:${selected.id}`)}
            />
          </label>
          <span className="tl-kf-readout">{selected.value.toFixed(2)}</span>
          <button type="button" className="tl-tool-btn" onClick={() => onRemove(selected.id)} aria-label="Delete keyframe">
            Delete key
          </button>
        </div>
      )}
      {selected?.easing === 'bezier' && (
        <div className="tl-kf-row">
          {(['x1', 'y1', 'x2', 'y2'] as const).map((axis) => (
            <label key={axis} className="tl-kf-ease">
              {axis}
              <input
                className="tl-kf-param"
                type="number"
                aria-label={`Bezier ${axis}`}
                min={axis.startsWith('x') ? 0 : -0.5}
                max={axis.startsWith('x') ? 1 : 1.5}
                step={0.01}
                value={handles[axis]}
                onChange={(event) => onPatch(selected.id, {
                  easing: 'bezier',
                  bezier: { ...handles, [axis]: Number(event.target.value) },
                })}
              />
            </label>
          ))}
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
