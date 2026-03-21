import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TopBar from '../components/layout/TopBar';

describe('TopBar', () => {
  it('renders the logo text', () => {
    render(
      <TopBar mode="photo" onModeChange={() => {}} onExport={() => {}} canExport={false} />
    );
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  it('renders Photo and Video mode buttons', () => {
    render(
      <TopBar mode="photo" onModeChange={() => {}} onExport={() => {}} canExport={false} />
    );
    expect(screen.getByText(/Photo/)).toBeInTheDocument();
    expect(screen.getByText(/Video/)).toBeInTheDocument();
  });

  it('highlights the active mode button', () => {
    render(
      <TopBar mode="photo" onModeChange={() => {}} onExport={() => {}} canExport={false} />
    );
    const photoBtn = screen.getByRole('button', { name: /Photo/i });
    expect(photoBtn).toHaveClass('active');
  });

  it('calls onModeChange with "video" when video button is clicked', () => {
    const onModeChange = vi.fn();
    render(
      <TopBar mode="photo" onModeChange={onModeChange} onExport={() => {}} canExport={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Video/i }));
    expect(onModeChange).toHaveBeenCalledWith('video');
  });

  it('disables export button when canExport is false', () => {
    render(
      <TopBar mode="photo" onModeChange={() => {}} onExport={() => {}} canExport={false} />
    );
    expect(screen.getByRole('button', { name: /Export/i })).toBeDisabled();
  });

  it('enables export button when canExport is true', () => {
    render(
      <TopBar mode="photo" onModeChange={() => {}} onExport={() => {}} canExport={true} />
    );
    expect(screen.getByRole('button', { name: /Export/i })).not.toBeDisabled();
  });

  it('calls onExport when export button is clicked and enabled', () => {
    const onExport = vi.fn();
    render(
      <TopBar mode="photo" onModeChange={() => {}} onExport={onExport} canExport={true} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Export/i }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
