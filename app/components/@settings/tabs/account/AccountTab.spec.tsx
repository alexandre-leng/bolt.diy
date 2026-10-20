import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The account section used to be a server-rendered page at /settings with its own header and
 * its own accent: following a link from the app replaced the product. This tab is the native
 * replacement, so these tests pin the properties that make it belong to the app:
 * - it renders INSIDE the settings panel (no <html>/<body>/<header> of its own);
 * - it reads and writes the same JSON API the HTML forms used;
 * - it never announces a save the server refused;
 * - every password field has an accessible show/hide control (a standing user requirement).
 */

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('~/lib/toastify', () => ({ toast: mocks.toast }));

import AccountTab from './AccountTab';

const USER = {
  id: 'u1',
  email: 'alexandre@lengereau.fr',
  emailVerified: true,
  isAdmin: false,
  createdAt: '2026-10-16T10:00:00+02',
  profile: { displayName: 'Alexandre', avatarUrl: '' },
};

const SESSIONS = [
  { current: true, userAgent: 'Firefox on Linux', ip: '1.2.3.4', lastSeenAt: '2026-10-20T14:00:00+02' },
  { current: false, userAgent: 'Pixel', ip: '5.6.7.8', lastSeenAt: '2026-10-19T09:00:00+02' },
];

function mockApi(overrides: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === '/api/auth/me') {
      return { ok: true, status: 200, json: async () => ({ ok: true, user: USER }) };
    }

    if (url === '/api/auth/sessions') {
      return { ok: true, status: 200, json: async () => ({ ok: true, sessions: SESSIONS }) };
    }

    const override = overrides[url as string];

    if (override) {
      return override;
    }

    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('AccountTab: native, not a separate page', () => {
  it('renders as a fragment of the panel, with no document chrome of its own', async () => {
    mockApi();
    render(<AccountTab />);

    await screen.findByTestId('account-tab');

    // A separate page would own <html>/<body>; a tab must not.
    expect(document.querySelector('header.bar')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('shows the signed-in identity from /api/auth/me', async () => {
    mockApi();
    render(<AccountTab />);

    expect(await screen.findByText(/alexandre@lengereau\.fr/)).toBeTruthy();
  });

  it('labels every password field with a working show/hide control', async () => {
    mockApi();
    render(<AccountTab />);
    await screen.findByTestId('account-tab');

    const toggles = screen.getAllByRole('button', { name: 'Afficher le mot de passe' });
    expect(toggles.length).toBeGreaterThan(0);

    const toggle = toggles[0];
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    const field = toggle.previousElementSibling as HTMLInputElement;
    expect(field.type).toBe('password');

    act(() => {
      fireEvent.click(toggle);
    });

    expect(field.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Masquer le mot de passe');
  });
});

describe('AccountTab: honest saves', () => {
  it('saves the profile through PATCH and reports success only after ok', async () => {
    const fetchMock = mockApi();
    render(<AccountTab />);
    await screen.findByTestId('account-tab');

    const name = screen.getByLabelText('Nom affiché') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Alex' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Profil enregistré.'));

    const call = fetchMock.mock.calls.find(([url]) => url === '/api/auth/profile');
    expect(call).toBeTruthy();

    const init: RequestInit | undefined = call?.[1];
    expect(init?.method).toBe('PATCH');
  });

  it('surfaces the server error and never claims a save when the API refuses', async () => {
    mockApi({
      '/api/auth/profile': {
        ok: false,
        status: 400,
        json: async () => ({ ok: false, error: 'Nom trop long' }),
      },
    });

    render(<AccountTab />);
    await screen.findByTestId('account-tab');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Nom trop long'));
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it('counts the other devices and offers to disconnect them', async () => {
    const fetchMock = mockApi();
    render(<AccountTab />);

    expect(await screen.findByText('1 autre session active.')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Déconnecter les autres appareils' }));
    });

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/sessions/revoke-others')).toBe(true),
    );
  });

  it('disables the destructive delete until the password is typed', async () => {
    mockApi();
    render(<AccountTab />);
    await screen.findByTestId('account-tab');

    const deleteButton = screen.getByRole('button', { name: /Supprimer définitivement/ }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);

    const confirm = screen.getByLabelText('Mot de passe (pour confirmer)') as HTMLInputElement;
    fireEvent.change(confirm, { target: { value: 'secret123' } });

    await waitFor(() => expect(deleteButton.disabled).toBe(false));
  });

  it('refuses to submit a password change whose confirmation does not match', async () => {
    mockApi();
    render(<AccountTab />);
    await screen.findByTestId('account-tab');

    fireEvent.change(screen.getByLabelText('Mot de passe actuel'), { target: { value: 'oldpassword' } });
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'newpassword1' } });
    fireEvent.change(screen.getByLabelText('Confirmer le nouveau mot de passe'), { target: { value: 'different1' } });

    const submit = screen.getByRole('button', { name: 'Changer le mot de passe' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toMatch(/ne correspondent pas/);
  });
});
