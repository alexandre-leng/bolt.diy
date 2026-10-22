import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { toast as baseToast } from 'react-toastify';
import { describe, expect, it, vi } from 'vitest';
import { toast } from './toastify';

/*
 * Garde-fou i18n: le bouton de copie du toast d'erreur était annoncé aux
 * lecteurs d'écran en anglais ("Copy error message") dans l'interface française.
 * Le libellé est vérifié sur l'instance réellement passée à react-toastify.
 */
describe('toast.error: accessible name of the copy button', () => {
  it('labels the copy control in French', () => {
    const spy = vi.spyOn(baseToast, 'error');

    act(() => {
      toast.error('Quota de projets atteint');
    });

    const options = spy.mock.calls.at(-1)?.[1] as { closeButton?: ReactElement } | undefined;
    const { unmount } = render(<>{options?.closeButton}</>);

    expect(screen.getByRole('button', { name: 'Copier le message d’erreur' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();

    unmount();
    spy.mockRestore();
  });
});
