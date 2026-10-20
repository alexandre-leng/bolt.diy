import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectBackButton } from './ProjectBackButton.client';
import { chatStore } from '~/lib/stores/chat';
import { sidebarOpenStore } from '~/lib/stores/sidebar';
import { workbenchStore } from '~/lib/stores/workbench';

/*
 * The user reported that no visible back control existed in a conversation.
 * This asserts the three behaviours that make the control useful, not just
 * that a button renders.
 */
describe('ProjectBackButton', () => {
  beforeEach(() => {
    localStorage.clear();
    chatStore.setKey('started', false);
    sidebarOpenStore.set(false);
    workbenchStore.showWorkbench.set(false);
  });

  it('renders nothing on the landing page', () => {
    render(<ProjectBackButton />);
    expect(screen.queryByTestId('back-to-projects')).toBeNull();
  });

  it('appears once a conversation has started', () => {
    chatStore.setKey('started', true);
    render(<ProjectBackButton />);
    expect(screen.getByTestId('back-to-projects')).toBeTruthy();
  });

  it('has an accessible name so it is discoverable, not an unlabelled icon', () => {
    chatStore.setKey('started', true);
    render(<ProjectBackButton />);

    const link = screen.getByRole('link', { name: 'Retour aux projets' });
    expect(link.getAttribute('aria-label')).toBe('Retour aux projets');
  });

  it('navigates back to the projects list without opening the sidebar panel', () => {
    chatStore.setKey('started', true);
    workbenchStore.showWorkbench.set(true);
    render(<ProjectBackButton />);

    const link = screen.getByTestId('back-to-projects');

    // A real destination, not a dead button: this is what "back" means.
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/');

    act(() => {
      fireEvent.click(link);
    });

    /*
     * The control sits 4px from the sidebar toggle, which already opens the panel. Sharing
     * that behaviour made two adjacent icons look like a duplicate and left the user inside
     * the conversation they asked to leave.
     */
    expect(sidebarOpenStore.get()).toBe(false);

    // The preview must not stay on top of the projects list on a phone.
    expect(workbenchStore.showWorkbench.get()).toBe(false);
  });

  it('is reachable by keyboard', () => {
    chatStore.setKey('started', true);
    render(<ProjectBackButton />);

    const link = screen.getByTestId('back-to-projects');
    expect(link.getAttribute('href')).toBe('/');
    link.focus();
    expect(document.activeElement).toBe(link);
  });
});
