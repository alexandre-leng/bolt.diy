import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { actionConfirmOptions, useConfirmDialog } from './useConfirmDialog';

afterEach(cleanup);

function Harness({ onResult }: { onResult: (value: boolean) => void }) {
  const { askConfirmation, confirmDialog } = useConfirmDialog();
  const [, setTick] = useState(0);

  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const value = await askConfirmation({
            title: 'Supprimer le projet ?',
            description: 'Cette action est irréversible.',
            confirmLabel: 'Supprimer le projet',
            destructive: true,
          });
          onResult(value);
          setTick((tick) => tick + 1);
        }}
      >
        Ouvrir
      </button>
      {confirmDialog}
    </div>
  );
}

function setup() {
  const results: boolean[] = [];
  const view = render(<Harness onResult={(value) => results.push(value)} />);
  const opener = screen.getByRole('button', { name: 'Ouvrir' });
  opener.focus();
  fireEvent.click(opener);

  return { results, opener, view };
}

describe('useConfirmDialog', () => {
  it('ouvre une boîte titrée, focus initial sur Annuler, sans rien exécuter', async () => {
    const { results } = setup();

    const dialog = await screen.findByRole('dialog', { name: 'Supprimer le projet ?' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Cette action est irréversible.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Annuler' })));
    expect(screen.getByRole('button', { name: 'Supprimer le projet' })).toBeTruthy();
    expect(results).toEqual([]);
  });

  it('résout true seulement après un clic sur l’action, puis rend le focus à l’ouvreur', async () => {
    const { results, opener } = setup();

    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer le projet' }));

    await waitFor(() => expect(results).toEqual([true]));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('Échap annule (false) et rend le focus à l’ouvreur', async () => {
    const { results, opener } = setup();

    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(results).toEqual([false]));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('Annuler résout false', async () => {
    const { results } = setup();

    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));

    await waitFor(() => expect(results).toEqual([false]));
  });

  it('le démontage pendant la question vaut refus', async () => {
    const { results, view } = setup();

    await screen.findByRole('dialog');
    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(results).toEqual([false]);
  });
});

describe('actionConfirmOptions', () => {
  it('libelle en français et marque les actions destructives', () => {
    expect(actionConfirmOptions({ name: 'Delete Site', variant: 'destructive' })).toMatchObject({
      title: 'Confirmer « Delete Site » ?',
      confirmLabel: 'Confirmer la suppression',
      destructive: true,
    });
    expect(
      actionConfirmOptions({
        name: 'Delete Site',
        variant: 'destructive',
        confirmation: { title: 'Supprimer ce site Netlify ?', confirmLabel: 'Supprimer le site' },
      }),
    ).toMatchObject({ title: 'Supprimer ce site Netlify ?', confirmLabel: 'Supprimer le site', destructive: true });
    expect(actionConfirmOptions({ name: 'Redeploy' }).destructive).toBe(false);
  });
});
