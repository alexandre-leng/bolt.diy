import type { LoaderFunctionArgs } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loader } from './api.model-policy';
import { __resetKeyCacheForTests } from '~/lib/.server/api/instance-keys';

vi.mock('~/lib/modules/llm/manager', () => ({
  LLMManager: {
    getInstance: () => ({
      getAllProviders: () => [{ name: 'OpenAI' }, { name: 'OpenCodeGo' }],
    }),
  },
}));

const MANAGED_POLICY = {
  managedMode: true,
  defaultModel: { provider: 'OpenCodeGo', model: 'deepseek-v4.1-flash' },
  allowedProviders: ['OpenCodeGo'],
  allowedModels: { OpenCodeGo: ['deepseek-v4.1-flash'] },
  effortPolicy: 'auto-only',
};

const runLoader = async (request: Request): Promise<Response> =>
  (await loader({ context: { cloudflare: { env: {} } }, request } as LoaderFunctionArgs)) as Response;

function makeRequest() {
  return new Request('http://localhost/api/model-policy', {
    headers: { 'X-Bolt-User-Id': 'user-policy' },
  });
}

describe('GET /api/model-policy', () => {
  beforeEach(() => {
    __resetKeyCacheForTests();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns the last valid policy when the accounts service is temporarily unavailable', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      Response.json({ apiKeys: {}, baseUrls: {}, allowUserKeys: [], source: {}, policy: MANAGED_POLICY }),
    );

    const first = await runLoader(makeRequest());
    expect(first.status).toBe(200);

    fetchMock.mockRejectedValueOnce(new Error('service unavailable'));

    const second = await runLoader(makeRequest());
    const body = await second.json();

    expect(second.status).toBe(200);
    expect(body).toMatchObject({
      managedMode: true,
      allowedProviders: ['OpenCodeGo'],
      allowedModels: { OpenCodeGo: ['deepseek-v4.1-flash'] },
      effortPolicy: 'auto-only',
    });
  });

  it('returns an error response envelope when accounts lookup is slow or unavailable', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('request timed out'));

    const response = await runLoader(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'Politique de modèles temporairement indisponible' });
    expect(body).not.toHaveProperty('managedMode');
    expect(body).not.toHaveProperty('allowedProviders');
  });
});
