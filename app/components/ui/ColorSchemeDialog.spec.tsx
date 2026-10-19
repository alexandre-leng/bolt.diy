import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColorSchemeDialog } from './ColorSchemeDialog';
import { defaultDesignScheme } from '~/types/design-scheme';

const savedScheme = {
  palette: { ...defaultDesignScheme.palette, primary: '#112233' },
  features: ['rounded'],
  font: ['sans-serif'],
};

// Font tiles expose the preview glyph before the label, so match the label node exactly.
function fontButton(scope: HTMLElement, label: string) {
  // Match the button by its visible label, whatever element renders the text inside it.
  const buttons = within(scope).getAllByRole('button');

  /*
   * The tile renders the glyph preview ("Aa") before the label, so compare the label exactly
   * against the tile's last text node rather than a prefix or a substring (Serif ⊂ Sans Serif).
   */
  const match = buttons.find((button) => {
    const labelNode = Array.from(button.querySelectorAll('div')).find((node) => node.textContent?.trim() === label);
    return labelNode !== undefined;
  });

  if (!match) {
    throw new Error(`no font button labelled "${label}"`);
  }

  return match as HTMLElement;
}

function openDialog(setDesignScheme = vi.fn()) {
  render(<ColorSchemeDialog designScheme={savedScheme} setDesignScheme={setDesignScheme} />);
  fireEvent.click(screen.getByTitle('Design Palette'));

  return screen.getByRole('dialog');
}

describe('ColorSchemeDialog', () => {
  it('exposes selected fonts and features through aria-pressed', () => {
    const dialog = openDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Typography' }));
    expect(fontButton(dialog, 'Sans Serif').getAttribute('aria-pressed')).toBe('true');
    expect(fontButton(dialog, 'Serif').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Features' }));
    expect(
      within(dialog)
        .getByRole('button', { name: /Rounded Corners/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      within(dialog)
        .getByRole('button', { name: /Subtle Border/ })
        .getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('discards unsaved changes on Cancel and reopens with the saved values', () => {
    const setDesignScheme = vi.fn();
    const dialog = openDialog(setDesignScheme);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Typography' }));
    fireEvent.click(fontButton(dialog, 'Serif'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }));

    expect(setDesignScheme).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByTitle('Design Palette'));

    const reopened = screen.getByRole('dialog');
    fireEvent.click(within(reopened).getByRole('button', { name: 'Typography' }));
    expect(fontButton(reopened, 'Serif').getAttribute('aria-pressed')).toBe('false');
  });

  it('discards unsaved changes on Escape', () => {
    const setDesignScheme = vi.fn();
    const dialog = openDialog(setDesignScheme);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Features' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Subtle Border/ }));
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(setDesignScheme).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('Design Palette'));

    const reopened = screen.getByRole('dialog');
    fireEvent.click(within(reopened).getByRole('button', { name: 'Features' }));
    expect(
      within(reopened)
        .getByRole('button', { name: /Subtle Border/ })
        .getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('persists changes only on Save', () => {
    const setDesignScheme = vi.fn();
    const dialog = openDialog(setDesignScheme);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Features' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Subtle Border/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));

    expect(setDesignScheme).toHaveBeenCalledTimes(1);
    expect(setDesignScheme.mock.calls[0][0].features).toEqual(['rounded', 'border']);
    expect(setDesignScheme.mock.calls[0][0].palette.primary).toBe('#112233');
  });

  it('keeps the outer dialog width container shrinkable (no viewport-based inner width)', () => {
    const dialog = openDialog();
    const inner = dialog.querySelector('.py-4.px-4') as HTMLElement;

    expect(inner.className).toContain('w-full');
    expect(inner.className).toContain('min-w-0');
    expect(inner.className).not.toContain('100vw');
  });
});
