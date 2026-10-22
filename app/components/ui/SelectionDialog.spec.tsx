import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionDialog } from './Dialog';

const items = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Bravo' },
  { id: 'c', label: 'Charlie' },
];

describe('SelectionDialog', () => {
  it('derives the select-all label from the selection, including after individual toggles', () => {
    render(<SelectionDialog title="Choisir" items={items} isOpen onClose={vi.fn()} onConfirm={vi.fn()} />);

    const selectAll = screen.getByRole('button', { name: 'Tout sélectionner' });
    fireEvent.click(selectAll);
    expect(screen.getByRole('button', { name: 'Tout désélectionner' })).toBeTruthy();

    // Deselecting one item must flip the global label back, without a stale flag.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bravo' }));
    expect(screen.getByRole('button', { name: 'Tout sélectionner' })).toBeTruthy();
  });

  it('toggles individual items and confirms only the selected ids', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<SelectionDialog title="Choisir" items={items} isOpen onClose={onClose} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Charlie' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledWith(['a', 'c']);
    expect(onClose).toHaveBeenCalled();
  });

  it('clears the selection when the dialog is reopened', () => {
    const { rerender } = render(
      <SelectionDialog title="Choisir" items={items} isOpen onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tout sélectionner' }));

    rerender(<SelectionDialog title="Choisir" items={items} isOpen={false} onClose={vi.fn()} onConfirm={vi.fn()} />);
    rerender(<SelectionDialog title="Choisir" items={items} isOpen onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Tout sélectionner' })).toBeTruthy();
    expect(screen.getByText('0 sur 3 sélectionnés')).toBeTruthy();
  });

  it('prunes selections that disappear when the items change', () => {
    const onConfirm = vi.fn();

    const { rerender } = render(
      <SelectionDialog title="Choisir" items={items} isOpen onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bravo' }));

    rerender(<SelectionDialog title="Choisir" items={[items[0]]} isOpen onClose={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.getByText('1 sur 1 sélectionnés')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith(['a']);
  });

  it('renders a French empty state without crashing when there are no items', () => {
    render(<SelectionDialog title="Choisir" items={[]} isOpen onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getByText('Aucun élément à afficher')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tout sélectionner' }).hasAttribute('disabled')).toBe(true);
  });

  it('cancels without confirming', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<SelectionDialog title="Choisir" items={items} isOpen onClose={onClose} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
