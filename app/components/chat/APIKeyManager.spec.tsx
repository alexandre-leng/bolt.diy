import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APIKeyManager } from './APIKeyManager';
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
