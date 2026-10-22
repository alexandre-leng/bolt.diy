import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Select } from './Select';

/*
 * A native <select> with `appearance: auto` keeps the platform chrome, which reads as a stray
 * control inside a themed form (grey gradient + bevel arrow on Chromium, something else again
 * on Firefox and Safari). The shared field must opt out and draw its own caret instead.
 */
describe('Select', () => {
  it('turns the native chrome off and draws one caret', () => {
    const { container } = render(
      <Select aria-label="Modèle" defaultValue="a">
        <option value="a">Modèle A</option>
      </Select>,
    );

    const select = screen.getByRole('combobox', { name: 'Modèle' });
    expect(select.className).toContain('appearance-none');

    const carets = container.querySelectorAll('.i-ph\\:caret-down');
    expect(carets).toHaveLength(1);
    expect(carets[0].getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps a 44px target and truncates long labels', () => {
    render(
      <Select aria-label="Voix" defaultValue="a">
        <option value="a">Microsoft Hortense (fr-FR) · locale</option>
      </Select>,
    );

    const select = screen.getByRole('combobox', { name: 'Voix' });
    expect(select.className).toContain('min-h-11');
    expect(select.className).toContain('truncate');
  });

  it('still forwards the native props and children', () => {
    render(
      <Select aria-label="Service" value="groq" disabled onChange={() => undefined}>
        <option value="openai">OpenAI</option>
        <option value="groq">Groq</option>
      </Select>,
    );

    const select = screen.getByRole('combobox', { name: 'Service' }) as unknown as HTMLSelectElement;
    expect(select.value).toBe('groq');
    expect(select.disabled).toBe(true);
    expect(select.options).toHaveLength(2);
  });
});
