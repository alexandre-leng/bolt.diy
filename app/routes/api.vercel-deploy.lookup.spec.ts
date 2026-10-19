import type { ActionFunctionArgs } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { action } from './api.vercel-deploy';

function request(body: unknown) {
  return {
    request: new Request('https://bolt.example/api/vercel-deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as ActionFunctionArgs;
}

afterEach(() => vi.unstubAllGlobals());

describe('Vercel lookup POST contract', () => {
  it('reads project and deployment without putting the credential in URLs or creating a deployment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'project-1', name: 'example' }))
      .mockResolvedValueOnce(
        Response.json({ deployments: [{ id: 'deploy-1', state: 'READY', url: 'example.vercel.app' }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const response = await action(request({ projectId: 'project-1', token: 'fixture-credential', lookup: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ project: { id: 'project-1' }, deploy: { id: 'deploy-1' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    for (const [url, options] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain('fixture-credential');
      expect(options.headers.Authorization).toBe('Bearer fixture-credential');
      expect(options.method).toBeUndefined();
    }
  });

  it('rejects a missing credential before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await action(request({ projectId: 'project-1', lookup: true }))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a missing project before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await action(request({ token: 'fixture-credential', lookup: true }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
