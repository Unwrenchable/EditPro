import React, { useRef, useState } from 'react';
import {
  builtinMotionTemplates,
  parseMotionTemplate,
  serializeMotionTemplate,
  type MotionChannel,
  type MotionDocument,
  type MotionShape,
  type MotionText,
} from '../../utils/video/motionGraphics';

interface MotionGraphicsPanelProps {
  document: MotionDocument;
  currentTime: number;
  disabled: boolean;
  onChange: (document: MotionDocument, coalesceKey?: string) => void;
}

type Selection = { kind: 'shape' | 'text'; id: string } | null;

const CHANNELS: { id: MotionChannel; label: string }[] = [
  { id: 'x', label: 'X' },
  { id: 'y', label: 'Y' },
  { id: 'scale', label: 'Scale' },
  { id: 'opacity', label: 'Opacity' },
  { id: 'rotation', label: 'Rotation' },
];

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000).toString(36)}`;
}

function baseShape(kind: MotionShape['kind'], time: number): MotionShape {
  return {
    id: newId(kind),
    kind,
    name: kind === 'ellipse' ? 'Ellipse' : kind === 'line' ? 'Line' : 'Rectangle',
    startTime: time,
    endTime: time + 4,
    fill: kind === 'line' ? '#d4a017' : '#111827',
    stroke: '#ffffff',
    strokeWidth: kind === 'line' ? 4 : 0,
    x: 0.2,
    y: kind === 'line' ? 0.6 : 0.7,
    width: kind === 'line' ? 0.4 : 0.3,
    height: kind === 'line' ? 0.01 : 0.12,
    rotation: 0,
    scale: 1,
    opacity: 1,
    channels: {},
  };
}

function baseText(time: number): MotionText {
  return {
    id: newId('text'),
    name: 'Text',
    startTime: time,
    endTime: time + 4,
    text: 'Title',
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: 8,
    color: '#ffffff',
    align: 'center',
    x: 0.5,
    y: 0.45,
    scale: 1,
    rotation: 0,
    opacity: 1,
    channels: {},
  };
}

const MotionGraphicsPanel: React.FC<MotionGraphicsPanelProps> = ({ document, currentTime, disabled, onChange }) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [message, setMessage] = useState<string | null>(null);
  const shape = document.shapes.find((item) => item.id === selection?.id && selection.kind === 'shape') ?? null;
  const text = document.texts.find((item) => item.id === selection?.id && selection.kind === 'text') ?? null;

  const updateShape = (id: string, partial: Partial<MotionShape>, key?: string) => {
    onChange({
      ...document,
      shapes: document.shapes.map((item) => (item.id === id ? { ...item, ...partial } : item)),
    }, key);
  };
  const updateText = (id: string, partial: Partial<MotionText>, key?: string) => {
    onChange({
      ...document,
      texts: document.texts.map((item) => (item.id === id ? { ...item, ...partial } : item)),
    }, key);
  };

  const addKey = (channel: MotionChannel) => {
    if (shape) {
      const current = shape.channels[channel] ?? [];
      const local = Math.max(0, currentTime - shape.startTime);
      const value = channel === 'opacity' ? shape.opacity : channel === 'scale' ? 1 : channel === 'rotation' ? shape.rotation : shape[channel];
      updateShape(shape.id, {
        channels: {
          ...shape.channels,
          [channel]: [...current.filter((key) => Math.abs(key.time - local) > 0.03), { time: Number(local.toFixed(3)), value, ease: 'easeOut' }],
        },
      });
      return;
    }
    if (!text) return;
    const current = text.channels[channel] ?? [];
    const local = Math.max(0, currentTime - text.startTime);
    const value = channel === 'opacity' ? text.opacity : channel === 'scale' ? text.scale : channel === 'rotation' ? text.rotation : channel === 'width' || channel === 'height' ? 0.2 : text[channel];
    updateText(text.id, {
      channels: {
        ...text.channels,
        [channel]: [...current.filter((key) => Math.abs(key.time - local) > 0.03), { time: Number(local.toFixed(3)), value, ease: 'easeOut' }],
      },
    });
  };

  const save = () => {
    const json = serializeMotionTemplate(document);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${document.name.replace(/[^\w.-]+/g, '_') || 'template'}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage('Template downloaded as JSON.');
  };

  const load = async (file: File) => {
    const template = parseMotionTemplate(await file.text());
    if (!template) {
      setMessage('That file is not an EditPro motion template.');
      return;
    }
    onChange(template.document);
    setSelection(null);
    setMessage(`Loaded ${template.name}.`);
  };

  return (
    <section className="motion-panel" aria-label="Titles and graphics">
      <div className="multicam-heading">
        <h2>Titles</h2>
      </div>
      <p className="panel-hint">Animated text and shapes. Templates save as JSON and load back onto this sequence.</p>
      <div className="creative-inline">
        <button type="button" className="tl-tool-btn" disabled={disabled} onClick={() => {
          const item = baseText(currentTime);
          onChange({ ...document, texts: [...document.texts, item] });
          setSelection({ kind: 'text', id: item.id });
        }}>Text</button>
        <button type="button" className="tl-tool-btn" disabled={disabled} onClick={() => {
          const item = baseShape('rect', currentTime);
          onChange({ ...document, shapes: [...document.shapes, item] });
          setSelection({ kind: 'shape', id: item.id });
        }}>Rectangle</button>
        <button type="button" className="tl-tool-btn" disabled={disabled} onClick={() => {
          const item = baseShape('ellipse', currentTime);
          onChange({ ...document, shapes: [...document.shapes, item] });
          setSelection({ kind: 'shape', id: item.id });
        }}>Ellipse</button>
        <button type="button" className="tl-tool-btn" disabled={disabled} onClick={() => {
          const item = baseShape('line', currentTime);
          onChange({ ...document, shapes: [...document.shapes, item] });
          setSelection({ kind: 'shape', id: item.id });
        }}>Line</button>
        <button type="button" className="tl-tool-btn" onClick={save}>Save template</button>
        <button type="button" className="tl-tool-btn" onClick={() => fileInput.current?.click()}>Load template</button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden-input"
        aria-label="Load motion template"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void load(file);
          event.target.value = '';
        }}
      />
      <div className="creative-inline">
        {builtinMotionTemplates().map((template) => (
          <button
            key={template.id}
            type="button"
            className="tl-tool-btn"
            disabled={disabled}
            onClick={() => {
              const stamped = template.document;
              onChange({
                ...document,
                name: template.label,
                shapes: [...document.shapes, ...stamped.shapes.map((item) => ({ ...item, id: newId(item.kind), startTime: currentTime + item.startTime, endTime: currentTime + item.endTime }))],
                texts: [...document.texts, ...stamped.texts.map((item) => ({ ...item, id: newId('text'), startTime: currentTime + item.startTime, endTime: currentTime + item.endTime }))],
              });
              setMessage(`Added ${template.label}.`);
            }}
          >
            {template.label}
          </button>
        ))}
      </div>
      <ul className="motion-items">
        {document.shapes.map((item) => (
          <li key={item.id}>
            <button type="button" className={selection?.id === item.id ? 'is-active' : ''} aria-pressed={selection?.id === item.id} onClick={() => setSelection({ kind: 'shape', id: item.id })}>
              {item.name}
            </button>
          </li>
        ))}
        {document.texts.map((item) => (
          <li key={item.id}>
            <button type="button" className={selection?.id === item.id ? 'is-active' : ''} aria-pressed={selection?.id === item.id} onClick={() => setSelection({ kind: 'text', id: item.id })}>
              {item.text || item.name}
            </button>
          </li>
        ))}
      </ul>
      {text && (
        <div className="creative-inline">
          <label>
            Text
            <input aria-label="Title text" value={text.text} onChange={(event) => updateText(text.id, { text: event.target.value }, 'motion-text')} />
          </label>
          <label>
            Size
            <input aria-label="Title size" type="number" min={1} max={40} value={text.fontSize} onChange={(event) => updateText(text.id, { fontSize: Number(event.target.value) }, 'motion-size')} />
          </label>
          <label>
            Color
            <input aria-label="Title color" type="color" value={text.color} onChange={(event) => updateText(text.id, { color: event.target.value })} />
          </label>
        </div>
      )}
      {shape && (
        <div className="creative-inline">
          <label>
            Fill
            <input aria-label="Shape fill" type="color" value={shape.fill} onChange={(event) => updateShape(shape.id, { fill: event.target.value })} />
          </label>
          <label>
            Width
            <input aria-label="Shape width" type="number" min={0.01} max={2} step={0.01} value={shape.width} onChange={(event) => updateShape(shape.id, { width: Number(event.target.value) }, 'motion-width')} />
          </label>
          <label>
            Height
            <input aria-label="Shape height" type="number" min={0.01} max={2} step={0.01} value={shape.height} onChange={(event) => updateShape(shape.id, { height: Number(event.target.value) }, 'motion-height')} />
          </label>
        </div>
      )}
      {(shape || text) && (
        <div className="creative-inline">
          {CHANNELS.map((channel) => (
            <button key={channel.id} type="button" className="tl-tool-btn" onClick={() => addKey(channel.id)}>
              Key {channel.label}
            </button>
          ))}
          <button
            type="button"
            className="tl-tool-btn"
            onClick={() => {
              if (shape) onChange({ ...document, shapes: document.shapes.filter((item) => item.id !== shape.id) });
              if (text) onChange({ ...document, texts: document.texts.filter((item) => item.id !== text.id) });
              setSelection(null);
            }}
          >
            Delete
          </button>
        </div>
      )}
      {message && <p className="playback-meta">{message}</p>}
    </section>
  );
};

export default MotionGraphicsPanel;
