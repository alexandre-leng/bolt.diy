import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ScreenshotToCode } from './ScreenshotToCode';

const mockups = [
  { direction: 'Minimaliste', image: 'data:image/png;base64,AAAA' },
  { direction: 'Affirmé', image: 'data:image/png;base64,BBBB' },
  { direction: 'Chaleureux', image: 'data:image/png;base64,CCCC' },
];

async function renderWithMockups() {
  render(<ScreenshotToCode generate={async () => []} designFor={async () => mockups} importCode={async () => ''} />);
  await userEvent.type(screen.getByLabelText('Description du design'), 'une boulangerie');
  await userEvent.click(screen.getByRole('button', { name: /Générer 3 maquettes/ }));
  await screen.findByRole('radio', { name: 'Maquette Minimaliste' });
}

describe('mockup full-screen viewer', () => {
  it('exposes one enlarge control per mockup', async () => {
    await renderWithMockups();

    expect(screen.getByRole('button', { name: 'Voir la maquette Minimaliste en grand' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voir la maquette Affirmé en grand' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voir la maquette Chaleureux en grand' })).toBeTruthy();
  });

  it('opens a viewer with zoom controls, then closes', async () => {
    await renderWithMockups();

    await userEvent.click(screen.getByRole('button', { name: 'Voir la maquette Affirmé en grand' }));

    // Radix names the dialog by its title (the mockup label), not by the content's aria-label.
    const viewer = await screen.findByRole('dialog', { name: 'Affirmé' });

    expect(screen.getByRole('button', { name: 'Choisir cette maquette' })).toBeTruthy();
    expect(viewer.textContent).toContain('Maquette 2 sur 3');
    expect(screen.getByLabelText('Zoom avant')).toBeTruthy();
    expect(screen.getByLabelText('Zoom arrière')).toBeTruthy();
    expect(screen.getByLabelText('Ajuster à l’écran')).toBeTruthy();

    await userEvent.click(screen.getByLabelText('Zoom avant'));
    expect(viewer.textContent).toContain('150 %');

    await userEvent.click(screen.getByLabelText('Fermer'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves to the next mockup and selects it', async () => {
    await renderWithMockups();

    await userEvent.click(screen.getByRole('button', { name: 'Voir la maquette Minimaliste en grand' }));
    await screen.findByText('Maquette 1 sur 3');

    await userEvent.click(screen.getByLabelText('Maquette suivante'));
    await screen.findByText('Maquette 2 sur 3');

    await userEvent.click(screen.getByLabelText('Fermer'));

    const tile = await screen.findByRole('radio', { name: 'Maquette Affirmé' });

    expect(tile.getAttribute('aria-checked')).toBe('true');
  });

  it('clamps zoom between 100 % and 600 %', async () => {
    await renderWithMockups();

    await userEvent.click(screen.getByRole('button', { name: 'Voir la maquette Minimaliste en grand' }));

    const viewer = await screen.findByRole('dialog');

    for (let step = 0; step < 8; step += 1) {
      await userEvent.click(screen.getByLabelText('Zoom avant'));
    }

    expect(viewer.textContent).toContain('600 %');

    for (let step = 0; step < 8; step += 1) {
      await userEvent.click(screen.getByLabelText('Zoom arrière'));
    }

    expect(viewer.textContent).toContain('100 %');
  });
});
