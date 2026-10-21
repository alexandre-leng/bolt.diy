import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminKeysTab } from './AdminKeysTab';
import { DEFAULT_TAB_CONFIG } from '~/components/@settings/core/constants';

/*
 * The instance-keys tab is the visual entry point for "only the admin configures the API keys".
 * Two things must hold, and hiding the tab is not what makes them true:
 *
 *  - the tab is declared admin-only in the tab catalogue, so the Settings panel filters it out
 *    for an ordinary account;
 *  - the tab renders "Accès réservé" for a non-admin, and the endpoints behind it answer 403
 *    (covered server-side in test_instance_keys.py).
 *
 * A stored key must never be rendered: the input starts empty and only a masked form is shown.
 */

const PROVIDER = {
  name: 'OpenAI',
  label: 'OpenAI (GPT)',
  needsKey: true,
  configured: true,
  maskedKey: 'sk-p…cdef',
  baseUrl: '',
  source: 'instance' as const,
  allowUserKeys: false,
};

function mockFetch(handlers: {
  session: { authenticated: boolean; isAdmin: boolean };
  providers?: () => Response;
  save?: () => Response;
  test?: () => Response;
}) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body as string | undefined });

    if (url.includes('/api/auth/me')) {
      return handlers.session.authenticated
        ? new Response(
            JSON.stringify({
              ok: true,
              user: { id: 'u1', email: 'x@y.z', emailVerified: true, isAdmin: handlers.session.isAdmin },
            }),
            { status: 200 },
          )
        : new Response(null, { status: 401 });
    }

    if (url.includes('/api/admin/providers/test')) {
      return handlers.test
        ? handlers.test()
        : new Response(JSON.stringify({ ok: true, detail: 'clé acceptée' }), { status: 200 });
    }

    if (url.includes('/api/admin/providers')) {
      if (method === 'PUT') {
        return handlers.save ? handlers.save() : new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (handlers.providers) {
        return handlers.providers();
      }

      return new Response(
        JSON.stringify({
          ok: true,
          providers: [PROVIDER],
          imageService: { providers: [{ name: 'openai', configured: false, maskedKey: '' }] },
        }),
        { status: 200 },
      );
    }

    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;

  return calls;
}

describe('AdminKeysTab', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('is declared administrator-only in the tab catalogue', () => {
    const tab = DEFAULT_TAB_CONFIG.find((entry) => entry.id === 'admin-keys');

    expect(tab, 'the admin-keys tab must exist in the catalogue').toBeTruthy();
    expect(tab?.isAdminOnly).toBe(true);
  });

  it('refuses a signed-in account that is not an administrator', async () => {
    mockFetch({ session: { authenticated: true, isAdmin: false } });
    render(<AdminKeysTab />);

    await waitFor(() => expect(screen.getByText('Accès réservé')).toBeTruthy());

    // And it never asks the admin endpoint for the keys.
    expect(screen.queryByText("Clés API de l'instance")).toBeNull();
  });

  it('refuses an anonymous visitor', async () => {
    mockFetch({ session: { authenticated: false, isAdmin: false } });
    render(<AdminKeysTab />);

    await waitFor(() => expect(screen.getByText('Accès réservé')).toBeTruthy());
  });

  it('lists the providers with a masked key and never the clear value for an admin', async () => {
    mockFetch({ session: { authenticated: true, isAdmin: true } });
    render(<AdminKeysTab />);

    await waitFor(() => expect(screen.getByText('OpenAI (GPT)')).toBeTruthy());

    expect(screen.getByText('sk-p…cdef')).toBeTruthy();
    expect(screen.getByText('configurée')).toBeTruthy();

    const input = screen.getByLabelText('Nouvelle clé pour OpenAI (GPT)') as HTMLInputElement;

    expect(input.value, 'the field must start empty, never pre-filled with the stored key').toBe('');
    expect(input.type).toBe('password');
  });

  it('toggles the typed key between masked and visible, with aria-pressed', async () => {
    mockFetch({ session: { authenticated: true, isAdmin: true } });
    render(<AdminKeysTab />);

    await waitFor(() => expect(screen.getByText('OpenAI (GPT)')).toBeTruthy());

    const input = screen.getByLabelText('Nouvelle clé pour OpenAI (GPT)') as HTMLInputElement;
    const toggle = screen.getByRole('button', { name: 'Afficher la clé saisie' });

    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(toggle);

    expect(input.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Masquer la clé saisie' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('saves the typed key for the instance', async () => {
    const calls = mockFetch({ session: { authenticated: true, isAdmin: true } });
    render(<AdminKeysTab />);

    await waitFor(() => expect(screen.getByText('OpenAI (GPT)')).toBeTruthy());

    await userEvent.type(screen.getByLabelText('Nouvelle clé pour OpenAI (GPT)'), 'sk-brand-new');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const put = calls.find((call) => call.method === 'PUT' && call.url.includes('/api/admin/providers'));

    expect(put, 'saving must reach the admin endpoint').toBeTruthy();
    expect(JSON.parse(put!.body || '{}')).toMatchObject({ provider: 'OpenAI', apiKey: 'sk-brand-new' });
  });

  it('shows the provider verdict returned by the server', async () => {
    mockFetch({
      session: { authenticated: true, isAdmin: true },
      test: () =>
        new Response(JSON.stringify({ ok: false, detail: 'clé refusée par le fournisseur (HTTP 401)' }), {
          status: 400,
        }),
    });
    render(<AdminKeysTab />);

    await waitFor(() => expect(screen.getByText('OpenAI (GPT)')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier' }));

    await waitFor(() => expect(screen.getByText('clé refusée par le fournisseur (HTTP 401)')).toBeTruthy());
  });
});
