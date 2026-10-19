import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import MotionGraphicsPanel from '../components/video/MotionGraphicsPanel';
import MotionStage from '../components/video/MotionStage';
import { createMotionDocument } from '../utils/video/motionGraphics';

describe('MotionGraphicsPanel', () => {
  it('adds a lower third the monitor can draw', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <MotionGraphicsPanel document={createMotionDocument()} currentTime={1} disabled={false} onChange={onChange} />,
    );
    await user.click(screen.getByRole('button', { name: 'Lower third' }));
    const next = onChange.mock.calls[0][0];
    expect(next.texts[0].text).toBe('Lower third');
    expect(next.shapes[0].kind).toBe('rect');
    rerender(<MotionStage document={next} currentTime={1.2} />);
    expect(document.querySelector('svg text')?.textContent).toBe('Lower third');
    expect(document.querySelector('svg rect')).toBeTruthy();
  });
});
