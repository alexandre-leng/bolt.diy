import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/components/header/ReportBugPanel', () => ({ ReportBugPanel: () => null }));
vi.mock('~/lib/persistence/ChatDescription.client', () => ({ ChatDescription: () => null }));

import { Header } from './Header';
import { chatStore } from '~/lib/stores/chat';

/*
 * The header mixed « Publier » with "New project", "Preview" and "Report Bug" (audit U13).
 */
const ENGLISH = ['New project', 'Preview', 'Report Bug', 'Back to projects', 'Collapse sidebar', 'Expand sidebar'];

afterEach(() => {
  chatStore.setKey('started', false);
});

describe('Header chrome language', () => {
  it('has no English label or accessible name in a conversation', async () => {
    chatStore.setKey('started', true);

    const { container } = render(<Header />);
    await screen.findByTestId('new-project');

    const names = Array.from(container.querySelectorAll('a, button')).flatMap((element) => [
      element.getAttribute('aria-label') ?? '',
      element.getAttribute('title') ?? '',
      element.textContent ?? '',
    ]);

    for (const word of ENGLISH) {
      expect(
        names.some((name) => name.includes(word)),
        word,
      ).toBe(false);
    }

    expect(screen.getByRole('link', { name: 'Nouveau projet' })).toBeTruthy();
  });
});
