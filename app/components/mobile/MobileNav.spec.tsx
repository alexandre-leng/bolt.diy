import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileNav, OPEN_SETTINGS_EVENT } from './MobileNav';
import { chatStore } from '~/lib/stores/chat';
import { sidebarOpenStore } from '~/lib/stores/sidebar';

describe('MobileNav', () => {
  beforeEach(() => {
    localStorage.clear();
    sidebarOpenStore.set(false);
    chatStore.setKey('started', false);
  });

  it('shows Home as the current tab on the landing page', () => {
    render(<MobileNav />);

    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
  });

  it('opens Projects (the history panel) and marks it current', () => {
    render(<MobileNav />);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    });

    expect(sidebarOpenStore.get()).toBe(true);
    expect(screen.getByRole('button', { name: 'Projects' }).getAttribute('aria-current')).toBe('page');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    });
    expect(sidebarOpenStore.get()).toBe(false);
  });

  it('asks the sidebar to open settings', () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_SETTINGS_EVENT, listener);
    render(<MobileNav />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(OPEN_SETTINGS_EVENT, listener);
  });

  it('hides behind settings and returns after closing', () => {
    render(<MobileNav />);

    act(() => {
      window.dispatchEvent(new CustomEvent('bolt:settings-visibility', { detail: { open: true } }));
    });
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent('bolt:settings-visibility', { detail: { open: false } }));
    });
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
  });

  it('renders visible labels for navigation items', () => {
    render(<MobileNav />);

    expect(screen.getByText('Home').textContent).toBe('Home');
    expect(screen.getByText('Projects').textContent).toBe('Projects');
    expect(screen.getByText('Settings').textContent).toBe('Settings');
  });

  it('is hidden during a conversation', () => {
    chatStore.setKey('started', true);

    const { container } = render(<MobileNav />);
    expect(container.innerHTML).toBe('');
  });
});
