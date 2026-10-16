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

  it('shows Accueil as the current tab on the landing page', () => {
    render(<MobileNav />);

    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accueil' }).getAttribute('aria-current')).toBe('page');
  });

  it('opens Projets (the history panel) and marks it current', () => {
    render(<MobileNav />);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Projets' }));
    });

    expect(sidebarOpenStore.get()).toBe(true);
    expect(screen.getByRole('button', { name: 'Projets' }).getAttribute('aria-current')).toBe('page');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Accueil' }));
    });
    expect(sidebarOpenStore.get()).toBe(false);
  });

  it('asks the sidebar to open settings', () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_SETTINGS_EVENT, listener);
    render(<MobileNav />);

    fireEvent.click(screen.getByRole('button', { name: 'Réglages' }));
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

    expect(screen.getByText('Accueil').textContent).toBe('Accueil');
    expect(screen.getByText('Projets').textContent).toBe('Projets');
    expect(screen.getByText('Réglages').textContent).toBe('Réglages');
  });

  it('keeps every target at least 44px tall and labels readable at 11px', () => {
    render(<MobileNav />);

    for (const label of ['Accueil', 'Projets', 'Réglages']) {
      const button = screen.getByRole('button', { name: label });

      // class contract: h-12 = 48px (>= 44px), min width 4.5rem, 11px label
      expect(button.className).toContain('h-12');
      expect(button.className).toContain('min-w-[4.5rem]');
    }

    expect(screen.getByText('Accueil').className).toContain('text-[11px]');
  });

  it('marks the active tab with a solid accent fill, not a tint', () => {
    render(<MobileNav />);

    const activeButton = screen.getByRole('button', { name: 'Accueil' });
    const inactiveButton = screen.getByRole('button', { name: 'Projets' });

    /*
     * Opaque ink fill: the app's accent-intensity preference paints the accent token
     * with alpha, which measured ~2.5:1 for white text. Ink is opaque at any setting.
     */
    expect(activeButton.className).toContain('bg-[#1c1c1c]');
    expect(activeButton.className).toContain('text-white');
    expect(activeButton.className).not.toContain('bg-accent-500');

    // inactive buttons carry full-strength ink, never a washed-out tint
    expect(inactiveButton.className).toContain('text-[#1c1c1c]');
    expect(inactiveButton.className).not.toContain('bg-[#1c1c1c]');
  });

  it('is hidden during a conversation', () => {
    chatStore.setKey('started', true);

    const { container } = render(<MobileNav />);
    expect(container.innerHTML).toBe('');
  });
});
