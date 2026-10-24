import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APIKeyManager } from './APIKeyManager';
import { resetSessionCache } from '~/lib/auth/session';
import type { ProviderInfo } from '~/types/model';

/*
 * Regression: the status started at `false`, so a red "Not Set" flashed until
 * /api/check-env-key answered, and a failed request was reported as a missing
 * key. Each test uses its own provider name because results are cached.
 */
const provider = (name: string) => ({ name, staticModels: [] }) as unknown as ProviderInfo;

afterEach(() => vi.unstubAllGlobals());

describe('APIKeyManager environment key status', () => {
  it('shows Checking… while the request is pending, then the env status', async () => {
    let answer!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );

    render(<APIKeyManager provider={provider('PendingProvider')} apiKey="" setApiKey={vi.fn()} />);

    expect(screen.getByTestId('api-key-status-checking')).toBeTruthy();
    expect(screen.queryByText(/Not Set/)).toBeNull();

    answer(Response.json({ isSet: true }));
    expect(await screen.findByText('Set via environment variable')).toBeTruthy();
  });

  it('does not claim the key is missing when the check fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Unauthorized', { status: 401 })),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<APIKeyManager provider={provider('FailingProvider')} apiKey="" setApiKey={vi.fn()} />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByText(/Not Set/)).toBeNull();
  });

  it('still reports Not Set when the server says so', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ isSet: false })),
    );

    render(<APIKeyManager provider={provider('MissingProvider')} apiKey="" setApiKey={vi.fn()} />);

    expect(await screen.findByText(/Not Set/)).toBeTruthy();
  });
});

/*
 * Only the administrator owns the provider keys: a normal account must not be offered a pencil
 * or a "Get API Key" link, because the server would ignore whatever it pasted. The gate reads
 * /api/auth/me, so the stub answers that route and the env-key route separately.
 */
describe('APIKeyManager admin gate', () => {
  const stubRoutes = (isAdmin: boolean) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes('/api/auth/me')) {
          return Response.json({ ok: true, user: { id: '1', email: 'a@b.co', isAdmin } });
        }

        return Response.json({ isSet: true, managed: false, userKeyAllowed: false });
      }),
    );

  const withLink = (name: string) =>
    ({ name, staticModels: [], getApiKeyLink: 'https://example.test/keys' }) as unknown as ProviderInfo;

  it('hides the edit and get-key controls from a normal account', async () => {
    stubRoutes(false);

    render(<APIKeyManager provider={withLink('GateUser')} apiKey="" setApiKey={vi.fn()} />);

    expect(await screen.findByText('Set via environment variable')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTitle('Edit API Key')).toBeNull());
    expect(screen.queryByTitle('Get API Key')).toBeNull();
  });

  it('shows them to an administrator', async () => {
    /*
     * `/api/auth/me` is read once and shared across concurrent components, so drop the cached
     * answer before stubbing this administrator, or the component receives the previous
     * (non-admin) answer and hides the pencil.
     */
    resetSessionCache();
    stubRoutes(true);

    /*
     * No key is typed on purpose: with a saved key the component offers no "Get API Key" link,
     * because the account already has one.
     */
    render(<APIKeyManager provider={withLink('GateAdmin')} apiKey="" setApiKey={vi.fn()} />);

    expect(await screen.findByTitle('Edit API Key')).toBeTruthy();
    expect(screen.getByTitle('Get API Key')).toBeTruthy();
  });
});
