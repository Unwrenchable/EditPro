import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import MulticamPanel from '../components/video/MulticamPanel';
import { createMulticamSequence, switchAngle } from '../utils/video/multicam';

describe('MulticamPanel', () => {
  it('cuts to the clicked angle at the playhead', async () => {
    const user = userEvent.setup();
    const sequence = switchAngle(createMulticamSequence([
      { id: 'wide', name: 'Wide', src: '/wide.mov' },
      { id: 'close', name: 'Close', src: '/close.mov' },
    ]), 1, 'close', 30);
    const onChange = vi.fn();
    render(
      <MulticamPanel
        sequence={sequence}
        currentTime={4}
        isPlaying
        duration={10}
        frameRate={30}
        mediaPath="/wide.mov"
        mediaName="wide.mov"
        mediaMissing={false}
        programUrl={null}
        advice="4K frames play back at quarter resolution."
        onChange={onChange}
        onCommit={vi.fn()}
        onRelinkFile={vi.fn()}
      />,
    );
    expect(screen.getByText('4K frames play back at quarter resolution.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch to Wide' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as ReturnType<typeof switchAngle>;
    expect(next.cuts.some((cut) => cut.time === 4 && cut.angleId === 'wide')).toBe(true);
  });

  it('commits the cut list onto the multicam track', async () => {
    const user = userEvent.setup();
    const sequence = createMulticamSequence([{ id: 'wide', name: 'Wide', src: '/wide.mov' }]);
    const onCommit = vi.fn();
    render(
      <MulticamPanel
        sequence={sequence}
        currentTime={0}
        isPlaying={false}
        duration={5}
        frameRate={30}
        mediaPath={null}
        mediaName={null}
        mediaMissing
        programUrl={null}
        advice={null}
        onChange={vi.fn()}
        onCommit={onCommit}
        onRelinkFile={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Commit cuts' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0][0]).toMatchObject({ src: '/wide.mov', trackId: 'v-multicam', endTime: 5 });
  });
});
