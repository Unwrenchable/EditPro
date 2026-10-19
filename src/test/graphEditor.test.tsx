import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GraphEditor from '../components/video/GraphEditor';
import type { ClipKeyframe } from '../types';

const keys: ClipKeyframe[] = [
  { id: 'a', time: 0, property: 'opacity', value: 0, easing: 'linear' },
  { id: 'b', time: 1, property: 'opacity', value: 1, easing: 'bezier', bezier: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 } },
];

describe('GraphEditor', () => {
  it('draws the curve and applies a bezier easing preset', () => {
    const onPreset = vi.fn();
    render(
      <GraphEditor
        keyframes={keys}
        property="opacity"
        duration={1}
        playhead={0.25}
        selectedKeyframeId="b"
        onSelect={vi.fn()}
        onChange={vi.fn()}
        onPreset={onPreset}
      />,
    );

    expect(screen.getByLabelText('Graph editor')).toBeInTheDocument();
    expect(screen.getByTestId('graph-curve').getAttribute('d')).toMatch(/^M/);
    expect(screen.getByRole('button', { name: 'Bezier handle left' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bezier handle right' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Graph keyframe b' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Easing preset Ease in cubic' }));
    expect(onPreset).toHaveBeenCalledWith('bezier', expect.objectContaining({ x1: 0.55, y1: 0.055 }));
  });
});
