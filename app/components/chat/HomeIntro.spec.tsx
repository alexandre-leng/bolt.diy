import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./GitCloneButton', () => ({ default: () => <button type="button">Cloner un dépôt</button> }));
vi.mock('~/components/chat/ImportFolderButton', () => ({
  ImportFolderButton: () => <button type="button">Importer un dossier</button>,
}));
vi.mock('~/components/chat/ImportZipButton', () => ({
  ImportZipButton: () => <button type="button">Importer un ZIP</button>,
}));

import { HOME_COPY, HomeHeroText, HomeImportActions } from './HomeIntro';
import { profileStore } from '~/lib/stores/profile';

/*
 * A-03: in production the landing screen still read « What will you build, Alexandre? »,
 * « Describe your app and Bolt builds it… », « or import » and aria-label « Import an existing
 * project ». These are the strings that were measured, pinned so they cannot come back.
 */
const ENGLISH = [/what will you build/i, /describe your app/i, /\bor import\b/i, /import an existing project/i];

const initialProfile = profileStore.get();

afterEach(() => {
  cleanup();
  profileStore.set(initialProfile);
});

function allText(container: HTMLElement) {
  const labels = Array.from(container.querySelectorAll('[aria-label], [title]')).flatMap((element) => [
    element.getAttribute('aria-label') ?? '',
    element.getAttribute('title') ?? '',
  ]);

  return [container.textContent ?? '', ...labels].join('\n');
}

describe('Accueil en français (A-03)', () => {
  it('salue l’utilisateur par son prénom, en français', () => {
    profileStore.set({ ...initialProfile, username: 'Alexandre' });

    render(<HomeHeroText />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Qu’allez-vous créer, Alexandre ?');
  });

  it('a un titre générique en français sans prénom', () => {
    profileStore.set({ ...initialProfile, username: '' });

    render(<HomeHeroText />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(HOME_COPY.titleDefault);
    expect(screen.getByText(HOME_COPY.subtitle)).toBeTruthy();
  });

  it('nomme le groupe d’import en français', () => {
    render(<HomeImportActions />);

    const group = screen.getByRole('group', { name: 'Importer un projet existant' });

    expect(group.textContent).toContain('ou importer');
  });

  it('ne contient plus aucune des chaînes anglaises mesurées en production', () => {
    profileStore.set({ ...initialProfile, username: 'Alexandre' });

    const { container } = render(
      <>
        <HomeHeroText />
        <HomeImportActions />
      </>,
    );

    const text = allText(container);

    for (const pattern of ENGLISH) {
      expect(text, String(pattern)).not.toMatch(pattern);
    }
  });
});
