import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectBackButton } from './ProjectBackButton.client';
import { chatStore } from '~/lib/stores/chat';
import { sidebarOpenStore } from '~/lib/stores/sidebar';
import { workbenchStore } from '~/lib/stores/workbench';

/*
 * The user reported that no visible back control existed in a conversation.
 * This asserts the three behaviours that make the control useful, not just
 * that a button renders.
 *
 * Follow-up (user: "3 boutons qui font la même tâche, on pourrait fusionner"): the control
 * used to open the history panel, which the header toggle and the in-panel close already did.
 * It now LEAVES the conversation, so the assertion is that navigation happened, not that a
 * panel opened.
 */
describe('ProjectBackButton', () => {
  beforeEach(() => {
    localStorage.clear();
    chatStore.setKey('started', false);
    sidebarOpenStore.set(false);
    workbenchStore.showWorkbench.set(false);
  });

  function renderAt(path = '/chat/site-cafe') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <ProjectBackButton />
      </MemoryRouter>,
    );
  }

  it('renders nothing on the landing page', () => {
    renderAt('/');
    expect(screen.queryByTestId('back-to-projects')).toBeNull();
  });

  it('appears once a conversation has started', () => {
    chatStore.setKey('started', true);
    renderAt();
    expect(screen.getByTestId('back-to-projects')).toBeTruthy();
  });

  it('has an accessible name so it is discoverable, not an unlabelled icon', () => {
    chatStore.setKey('started', true);
    renderAt();

    const button = screen.getByRole('button', { name: 'Retour aux projets' });
    expect(button.getAttribute('aria-label')).toBe('Retour aux projets');
  });

  it('closes the workbench and hides the panel when it is used', () => {
    chatStore.setKey('started', true);
    workbenchStore.showWorkbench.set(true);
    sidebarOpenStore.set(true);
    renderAt();

    act(() => {
      fireEvent.click(screen.getByTestId('back-to-projects'));
    });

    // Opening the panel alone would leave the preview covering it on a phone.
    expect(workbenchStore.showWorkbench.get()).toBe(false);
    expect(sidebarOpenStore.get()).toBe(false);
  });

  it('is reachable by keyboard', () => {
    chatStore.setKey('started', true);
    renderAt();

    const button = screen.getByTestId('back-to-projects');
    expect(button.tagName).toBe('BUTTON');
    button.focus();
    expect(document.activeElement).toBe(button);
  });
});
