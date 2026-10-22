import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ScreenshotToCode } from './ScreenshotToCode';

/** No variants/mockups: these tests only inspect the chrome, not a generation. */
const nothing = async () => [];

function renderPanel() {
  return render(<ScreenshotToCode generate={nothing} designFor={nothing} importCode={async () => ''} />);
}

describe('ScreenshotToCode uses Bolt design tokens and primitives', () => {
  it('renders the file input and action with Bolt primitives once the image mode is active', async () => {
    const { container } = renderPanel();

    await userEvent.click(screen.getByRole('radio', { name: 'Utiliser une image' }));

    const input = screen.getByLabelText('Image de capture');
    expect(input.className).toContain('bg-bolt-elements-background');
    expect(input.className).toContain('border-bolt-elements-border');

    const action = screen.getByRole('button', { name: /Créer le projet/ });
    expect(action.className).toContain('inline-flex');
    expect(action.className).toContain('rounded-md');

    const label = container.querySelector('label[for="screenshot-image"]');
    expect(label?.className).toContain('text-sm');
    expect(label?.className).toContain('font-medium');
  });

  it('states the project stack instead of exposing a selector', () => {
    renderPanel();

    /*
     * The stack is a product decision (React + TypeScript + Tailwind + shadcn/ui), not a field:
     * Lovable does not let you choose a framework and Bolt makes that call once, at project
     * creation. Asking per generation produced code nobody could develop.
     */
    expect(screen.queryByLabelText('Stack de sortie')).toBeNull();
    expect(screen.getByText(/React \+ TypeScript \+ Tailwind \+ shadcn\/ui/)).toBeTruthy();
  });

  it('styles the prompt textarea with the panel tokens', () => {
    renderPanel();

    const prompt = screen.getByLabelText('Description du design');
    expect(prompt.className).toContain('bg-bolt-elements-background-depth-1');
    expect(prompt.className).toContain('border-bolt-elements-borderColor');
    expect(prompt.className).toContain('text-bolt-elements-textPrimary');
  });
});

describe('the mode switch is visible, not hidden in a menu', () => {
  it('renders both options as cards with an icon, a title and a hint', () => {
    renderPanel();

    const designMode = screen.getByRole('radio', { name: 'Générer un design' });
    const imageMode = screen.getByRole('radio', { name: 'Utiliser une image' });

    // Icon + title + hint: the choice reads at a glance instead of needing a dropdown.
    expect(designMode.querySelector('[class*="i-ph:"]')).toBeTruthy();
    expect(designMode.textContent).toContain('Générer un design');
    expect(designMode.textContent).toContain('choisissez une maquette');

    expect(imageMode.querySelector('[class*="i-ph:"]')).toBeTruthy();
    expect(imageMode.textContent).toContain('Utiliser une image');
    expect(imageMode.textContent).toContain('capture');

    // The active one is marked visually, not only semantically.
    expect(designMode.className).toContain('border-bolt-elements-borderColorActive');

    // A card must never share the dialog's own fill: depth-2 on a depth-2 surface was
    // literally invisible, which is what made both cards read as "greyed out".
    expect(designMode.className).not.toMatch(/(^|\s)bg-bolt-elements-background-depth-2(\s|$)/);
    expect(imageMode.className).not.toMatch(/(^|\s)bg-bolt-elements-background-depth-2(\s|$)/);

    // Each card paints its own surface instead of inheriting the UA button grey.
    expect(designMode.className).toContain('bg-bolt-elements-background-depth-3');
    expect(imageMode.className).toContain('bg-bolt-elements-background-depth-1');
  });
});

describe('ScreenshotToCode primary action follows the Bolt primary button tokens', () => {
  it('uses the primary accent for the main action and a styled file trigger', async () => {
    renderPanel();

    const designs = screen.getByRole('button', { name: /Générer 3 maquettes/ });

    /*
     * The main action must PAINT: the token pair below is a 10% accent tint measuring 4.89:1 and
     * identical to the dialog surface on the dark theme. A filled accent button is legible in both.
     */
    expect(designs.className).toContain('!bg-accent-700');
    expect(designs.className).toContain('!text-white');
    expect(designs.className).toContain('!rounded-full');

    await userEvent.click(screen.getByRole('radio', { name: 'Utiliser une image' }));

    const input = screen.getByLabelText('Image de capture');
    expect(input.className).toContain('rounded-full');
  });
});

describe('generated mockups can be viewed full screen with zoom', () => {
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

  it('offers one enlarge action per mockup', async () => {
    await renderWithMockups();

    expect(screen.getByRole('button', { name: 'Voir la maquette Minimaliste en grand' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voir la maquette Affirmé en grand' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voir la maquette Chaleureux en grand' })).toBeTruthy();
  });

  it('opens a full-screen viewer with zoom in, 100 % readout and close', async () => {
    await renderWithMockups();

    await userEvent.click(screen.getByRole('button', { name: 'Voir la maquette Affirmé en grand' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Maquette 2 sur 3');

    // The mockup is shown at full size, not the 40px-thumbnail crop.
    expect(screen.getByRole('img', { name: 'Maquette Affirmé en grand' })).toBeTruthy();
    expect(screen.getByText('100 %')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Zoom avant' }));
    expect(screen.getByText('150 %')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('walks to the next mockup from the viewer and selects it', async () => {
    await renderWithMockups();

    await userEvent.click(screen.getByRole('button', { name: 'Voir la maquette Minimaliste en grand' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Maquette 1 sur 3');

    await userEvent.click(screen.getByRole('button', { name: 'Maquette suivante' }));
    await screen.findByText('Maquette 2 sur 3');

    // Back to the panel: the walked-to mockup is the chosen one.
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));

    const tile = await screen.findByRole('radio', { name: 'Maquette Affirmé' });
    expect(tile.getAttribute('aria-checked')).toBe('true');
  });
});
