import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/components/header/ReportBugPanel', () => ({ ReportBugPanel: () => null }));
vi.mock('~/lib/persistence/ChatDescription.client', () => ({ ChatDescription: () => null }));

import { Header } from './Header';
import { chatStore } from '~/lib/stores/chat';
import { sidebarOpenStore, closeSidebar } from '~/lib/stores/sidebar';
import { workbenchStore } from '~/lib/stores/workbench';

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

    // The back control was removed at the user's request: the logo and the panel cover the need.
    expect(container.querySelectorAll('[data-testid="back-to-projects"]').length).toBe(0);
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

  it('opens the panel with a glyph that cannot be read as "back"', () => {
    chatStore.setKey('started', true);
    sidebarOpenStore.set(false);
    renderHeader();

    const toggle = screen.getByTestId('sidebar-toggle');
    const glyph = toggle.querySelector('span');
    expect(glyph?.className).toContain('i-ph:list-dashes');
    expect(glyph?.className).not.toContain('caret');
    expect(glyph?.className).not.toContain('sidebar-simple');

    // No directional chevron is left in the header: the back control that owned it is gone.
    expect(screen.queryByTestId('back-to-projects')).toBeNull();
  });

  it('marks the toggle as a separate control family from the back button', () => {
    chatStore.setKey('started', true);
    renderHeader();

    /*
     * The separation only existed to tell the toggle apart from the back button. With the back
     * button gone, the toggle must no longer claim to be a separate family: a lone control with a
     * separator next to nothing reads as a broken border.
     */
    expect(screen.getByTestId('sidebar-toggle').className).not.toContain('header-icon-control--separated');
  });

  it('points aria-controls at the panel element', () => {
    renderHeader();
    expect(screen.getByTestId('sidebar-toggle').getAttribute('aria-controls')).toBe('sidebar-panel');
  });
});

/*
 * B-02 / 768 px (vérification prod du 22/10). jsdom has no layout, so these tests pin the
 * structural rules that make the measured geometry hold; the pixel measurement itself
 * (no overlap, elementFromPoint = each control, right edge <= viewport) is redone on the
 * deployed build at 390/768/1024/1440.
 */
describe('Header layout at narrow widths', () => {
  it('never lets the logo cluster shrink under the controls (390 px overlap)', async () => {
    chatStore.setKey('started', true);
    renderHeader();
    await screen.findByTestId('new-project');

    const left = screen.getByTestId('header-left-cluster');
    expect(left.className).toMatch(/\bshrink-0\b/);
    expect(left.className).not.toMatch(/\bmin-w-0\b/);
    expect(left.contains(screen.getByRole('link', { name: 'Accueil bolt.diy' }))).toBe(true);
  });

  it('keeps the phone controls icon-only, with their accessible names', async () => {
    chatStore.setKey('started', true);
    workbenchStore.showWorkbench.set(false);
    renderHeader();
    await screen.findByTestId('new-project');

    const preview = screen.getByTestId('mobile-preview-button');
    expect(preview.getAttribute('aria-label')).toMatch(/^Ouvrir l’aperçu/);
    expect(preview.className).toMatch(/\bw-9\b/);

    const previewLabel = Array.from(preview.querySelectorAll('span')).find((span) => span.textContent === 'Aperçu');
    expect(previewLabel?.className).toContain('hidden sm:inline');

    const publish = screen.getByTestId('publish-button');
    expect(publish.getAttribute('aria-label')).toBe('Publier');

    const publishLabel = Array.from(publish.querySelectorAll('span')).find((span) => span.textContent === 'Publier');
    expect(publishLabel?.className).toContain('hidden sm:inline');
  });

  it('gives the title slot the only flexible width, clipped inside the header (768 px)', async () => {
    chatStore.setKey('started', true);
    renderHeader();
    await screen.findByTestId('new-project');

    const slot = screen.getByTestId('header-title-slot');
    expect(slot.className).toMatch(/\bflex-1\b/);
    expect(slot.className).toMatch(/\bmin-w-0\b/);
    expect(slot.className).toMatch(/\boverflow-hidden\b/);
    expect(screen.getByTestId('header-right-cluster').className).toMatch(/\bshrink-0\b/);
  });
});
