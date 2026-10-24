import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeSwitch } from './ThemeSwitch';

/*
 * Garde-fou i18n: l'infobulle du sélecteur de thème était "Toggle Theme",
 * seule chaîne anglaise du panneau Projets.
 */
describe('ThemeSwitch accessible name', () => {
  it('exposes a French tooltip', () => {
    render(<ThemeSwitch />);
    expect(screen.getByTitle('Changer de thème')).toBeTruthy();
    expect(screen.queryByTitle('Toggle Theme')).toBeNull();
  });
});
