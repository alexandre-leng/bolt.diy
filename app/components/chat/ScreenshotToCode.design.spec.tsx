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

    const input = screen.getByLabelText('Image de la capture');
    expect(input.className).toContain('bg-bolt-elements-background');
    expect(input.className).toContain('border-bolt-elements-border');

    const action = screen.getByRole('button', { name: 'Transformer cette image en code' });
    expect(action.className).toContain('inline-flex');
    expect(action.className).toContain('rounded-md');

    const label = container.querySelector('label[for="screenshot-image"]');
    expect(label?.className).toContain('text-sm');
    expect(label?.className).toContain('font-medium');
  });

  it('styles the output stack selector with the same tokens as the rest of the panel', () => {
    renderPanel();

    const stack = screen.getByLabelText('Technologies de sortie');
    expect(stack.className).toContain('bg-bolt-elements-background-depth-1');
    expect(stack.className).toContain('border-bolt-elements-borderColor');
    expect(stack.className).toContain('text-bolt-elements-textPrimary');
  });

  it('styles the prompt textarea with the panel tokens', () => {
    renderPanel();

    const prompt = screen.getByLabelText('Description de la maquette');
    expect(prompt.className).toContain('bg-bolt-elements-background-depth-1');
    expect(prompt.className).toContain('border-bolt-elements-borderColor');
    expect(prompt.className).toContain('text-bolt-elements-textPrimary');
  });
});

describe('the mode switch is visible, not hidden in a menu', () => {
  it('renders both options as cards with an icon, a title and a hint', () => {
    renderPanel();

    const designMode = screen.getByRole('radio', { name: 'Créer une maquette' });
    const imageMode = screen.getByRole('radio', { name: 'Utiliser une image' });

    // Icon + title + hint: the choice reads at a glance instead of needing a dropdown.
    expect(designMode.querySelector('[class*="i-ph:"]')).toBeTruthy();
    expect(designMode.textContent).toContain('Créer une maquette');
    expect(designMode.textContent).toContain('choisissez une maquette');

    expect(imageMode.querySelector('[class*="i-ph:"]')).toBeTruthy();
    expect(imageMode.textContent).toContain('Utiliser une image');
    expect(imageMode.textContent).toContain('capture');

    // The active one is marked visually, not only semantically.
    expect(designMode.className).toContain('border-bolt-elements-borderColorActive');
  });
});

describe('ScreenshotToCode primary action follows the Bolt primary button tokens', () => {
  it('uses the primary accent for the main action and a styled file trigger', async () => {
    renderPanel();

    const designs = screen.getByRole('button', { name: /Générer 3 maquettes/ });
    expect(designs.className).toContain('bg-bolt-elements-button-primary-background');
    expect(designs.className).toContain('hover:bg-bolt-elements-button-primary-backgroundHover');
    expect(designs.className).toContain('!rounded-full');

    await userEvent.click(screen.getByRole('radio', { name: 'Utiliser une image' }));

    const input = screen.getByLabelText('Image de la capture');
    expect(input.className).toContain('rounded-full');
  });
});
