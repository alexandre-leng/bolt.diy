import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/components/header/ReportBugPanel', () => ({ ReportBugPanel: () => null }));
vi.mock('~/lib/persistence/ChatDescription.client', () => ({ ChatDescription: () => null }));

import { Header } from './Header';
import { chatStore } from '~/lib/stores/chat';
import { sidebarOpenStore, closeSidebar } from '~/lib/stores/sidebar';

/*
 * The header mixed « Publier » with "New project", "Preview" and "Report Bug" (audit U13).
 */
const ENGLISH = ['New project', 'Preview', 'Report Bug', 'Back to projects', 'Collapse sidebar', 'Expand sidebar'];

afterEach(() => {
  chatStore.setKey('started', false);
  closeSidebar();
});

function renderHeader() {
  return render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>,
  );
}

describe('Header chrome language', () => {
  it('has no English label or accessible name in a conversation', async () => {
    chatStore.setKey('started', true);

    const { container } = renderHeader();
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

/*
 * One handle per intention (user: "3 boutons qui font la même tâche, on pourrait fusionner").
 *
 * The panel could be opened by the header toggle, a floating edge chevron and the "back to
 * projects" chevron, and closed by two controls wearing the same left chevron. These tests pin
 * the merged contract: one toggle that opens AND closes, and a back control that actually
 * leaves the conversation.
 */
describe('Header sidebar controls', () => {
  it('exposes exactly one sidebar control in a conversation', () => {
    chatStore.setKey('started', true);

    const { container } = renderHeader();

    const toggles = container.querySelectorAll('[data-testid="sidebar-toggle"]');
    expect(toggles.length).toBe(1);
    expect(container.querySelectorAll('[data-testid="back-to-projects"]').length).toBe(1);
  });

  it('opens and closes the panel with the same button', () => {
    sidebarOpenStore.set(false);
    renderHeader();

    const toggle = screen.getByTestId('sidebar-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Ouvrir le panneau');

    act(() => {
      fireEvent.click(toggle);
    });
    expect(sidebarOpenStore.get()).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Fermer le panneau');

    act(() => {
      fireEvent.click(toggle);
    });
    expect(sidebarOpenStore.get()).toBe(false);
    expect(toggle.getAttribute('aria-label')).toBe('Ouvrir le panneau');
  });

  it('points aria-controls at the panel element', () => {
    renderHeader();
    expect(screen.getByTestId('sidebar-toggle').getAttribute('aria-controls')).toBe('sidebar-panel');
  });
});
