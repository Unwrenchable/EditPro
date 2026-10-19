import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { resetPageBootToken } from '../services/projectIO';

beforeEach(() => {
  localStorage.clear();
  resetPageBootToken();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

describe('App history controls', () => {
  it('undoes a photo adjustment from the toolbar and from Ctrl+Z', () => {
    render(<App />);

    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('file input missing');
    fireEvent.change(input, {
      target: { files: [new File(['pixels'], 'still.png', { type: 'image/png' })] },
    });

    const brightness = screen.getByRole('slider', { name: 'Brightness' });
    fireEvent.change(brightness, { target: { value: '40' } });
    expect(brightness).toHaveValue('40');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();

    fireEvent.keyDown(brightness, { key: 'z', ctrlKey: true });
    expect(screen.getByRole('slider', { name: 'Brightness' })).toHaveValue('0');
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();

    fireEvent.change(screen.getByRole('slider', { name: 'Brightness' }), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('slider', { name: 'Brightness' })).toHaveValue('0');
    expect(screen.getByText('Untitled*')).toBeInTheDocument();
  });
});
