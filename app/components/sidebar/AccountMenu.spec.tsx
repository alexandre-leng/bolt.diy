import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountMenu } from './AccountMenu';

/**
 * The account control is the only in-app way to sign out. It must show the right verb for
 * the actual session state, and the sign-out must go through the server endpoint — a
 * client-side "sign out" that only forgets local state would leave the session cookie
 * alive, which is exactly the bug a UI-only implementation ships.
 */
describe('AccountMenu', () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, assign: vi.fn() },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, 'location', { writable: true, value: originalLocation });
    vi.restoreAllMocks();
  });

  const withSession = (user: Record<string, unknown> | null) => {
    globalThis.fetch = vi.fn(async () =>
      user ? new Response(JSON.stringify({ ok: true, user }), { status: 200 }) : new Response(null, { status: 401 }),
    ) as unknown as typeof fetch;
  };

  const admin = { id: 'u1', email: 'alexandre@lengereau.fr', emailVerified: true, isAdmin: true };

  it('offers a sign-out and the account entry when the session is valid', async () => {
    withSession(admin);
    render(<AccountMenu />);

    await userEvent.click(screen.getByTestId('account-menu-trigger'));

    await waitFor(() => expect(screen.getByTestId('account-signout')).toBeTruthy());
    expect(screen.getByText('Connecté')).toBeTruthy();

    /*
     * "Mon compte" must NOT navigate to /settings any more: that left the app for a
     * server-rendered page with its own header. It opens the native account tab instead,
     * through the same event the mobile navigation uses.
     */
    const accountEntry = screen.getByTestId('account-settings');
    expect(accountEntry.tagName).toBe('BUTTON');
    expect(accountEntry.getAttribute('href')).toBeNull();

    expect(screen.queryByTestId('account-signin')).toBeNull();
  });

  it('asks the app to open the account tab, not a URL', async () => {
    withSession(admin);

    const opened = vi.fn();
    window.addEventListener('bolt:open-settings', opened);

    render(<AccountMenu />);
    await userEvent.click(screen.getByTestId('account-menu-trigger'));
    await waitFor(() => expect(screen.getByTestId('account-settings')).toBeTruthy());

    await userEvent.click(screen.getByTestId('account-settings'));

    await waitFor(() => expect(opened).toHaveBeenCalled());
    expect((opened.mock.calls[0][0] as CustomEvent).detail?.tab).toBe('account');

    window.removeEventListener('bolt:open-settings', opened);
  });

  it('shows the admin badge only for an admin', async () => {
    withSession(admin);

    const { unmount } = render(<AccountMenu />);

    await userEvent.click(screen.getByTestId('account-menu-trigger'));
    await waitFor(() => expect(screen.getByTestId('account-admin-badge')).toBeTruthy());
    expect(screen.getByText('Administrateur')).toBeTruthy();
    unmount();

    withSession({ ...admin, isAdmin: false });
    render(<AccountMenu />);
    await userEvent.click(screen.getByTestId('account-menu-trigger'));
    await waitFor(() => expect(screen.getByTestId('account-signout')).toBeTruthy());
    expect(screen.queryByTestId('account-admin-badge')).toBeNull();
  });

  it('shows the account email', async () => {
    withSession(admin);
    render(<AccountMenu />);

    await userEvent.click(screen.getByTestId('account-menu-trigger'));

    await waitFor(() => expect(screen.getByText('alexandre@lengereau.fr')).toBeTruthy());
  });

  it('offers a sign-in link when there is no session', async () => {
    withSession(null);
    render(<AccountMenu />);

    await userEvent.click(screen.getByTestId('account-menu-trigger'));

    await waitFor(() => expect(screen.getByTestId('account-signin')).toBeTruthy());
    expect(screen.getByTestId('account-signin').getAttribute('href')).toBe('/login');
    expect(screen.queryByTestId('account-signout')).toBeNull();
  });

  it('signs out through the server endpoint', async () => {
    withSession(admin);
    render(<AccountMenu />);

    await userEvent.click(screen.getByTestId('account-menu-trigger'));
    await waitFor(() => expect(screen.getByTestId('account-signout')).toBeTruthy());
    await userEvent.click(screen.getByTestId('account-signout'));

    expect(window.location.assign).toHaveBeenCalledWith('/logout');
  });

  it('exposes its state to assistive tech', async () => {
    withSession(admin);
    render(<AccountMenu />);

    const trigger = screen.getByTestId('account-menu-trigger');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');

    await userEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on Escape', async () => {
    withSession(admin);
    render(<AccountMenu />);

    await userEvent.click(screen.getByTestId('account-menu-trigger'));
    await waitFor(() => expect(screen.getByTestId('account-menu-panel')).toBeTruthy());

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByTestId('account-menu-panel')).toBeNull());
  });

  /*
   * Regression for "Se déconnecter est illisible".
   *
   * A <button> with no background utility keeps the browser's native button fill —
   * measured rgb(239,239,239) on Chromium — while the text uses the theme colour. Under a
   * dark theme that is near-white on light grey: a contrast near 1:1 against a 4.5:1
   * requirement. Only the BUTTON was affected, because an <a> gets no native fill, which is
   * why "Mon compte" looked right beside it. Asserting on the class rather than on a
   * computed colour keeps this runnable in jsdom, which does not paint.
   */
  it('gives the sign-out button an explicit background, not the browser default', async () => {
    withSession(admin);
    render(<AccountMenu />);

    // The entries only exist once the menu is open.
    await userEvent.click(screen.getByTestId('account-menu-trigger'));
    await waitFor(() => expect(screen.getByTestId('account-menu-panel')).toBeTruthy());

    const signout = screen.getByTestId('account-signout');

    expect(signout.className).toContain('bg-transparent');
    expect(signout.className).toContain('appearance-none');
  });

  it('styles every menu entry the same, so none keeps a native fill', async () => {
    withSession(admin);
    render(<AccountMenu />);

    await userEvent.click(screen.getByTestId('account-menu-trigger'));
    await waitFor(() => expect(screen.getByTestId('account-menu-panel')).toBeTruthy());

    for (const id of ['account-settings', 'account-signout']) {
      const item = screen.getByTestId(id);

      expect(item.className, `${id} must not rely on the browser's button fill`).toContain('bg-transparent');
    }
  });
});
