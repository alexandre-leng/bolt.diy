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

    const button = screen.getByRole('button', { name: 'Back to projects' });
    expect(button.getAttribute('aria-label')).toBe('Back to projects');
  });

  it('returns to the projects list and closes the workbench when clicked', () => {
    chatStore.setKey('started', true);
    workbenchStore.showWorkbench.set(true);
    render(<ProjectBackButton />);

    act(() => {
      fireEvent.click(screen.getByTestId('back-to-projects'));
    });

    // Opening the panel alone would leave the preview covering it on a phone.
    expect(sidebarOpenStore.get()).toBe(true);
    expect(workbenchStore.showWorkbench.get()).toBe(false);
  });

  it('is reachable by keyboard', () => {
    chatStore.setKey('started', true);
    render(<ProjectBackButton />);

    const button = screen.getByTestId('back-to-projects');
    expect(button.tagName).toBe('BUTTON');
    button.focus();
    expect(document.activeElement).toBe(button);
  });
});
