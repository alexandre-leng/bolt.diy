import type { ActionFunctionArgs } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { action as githubAction } from './api.github-user';
import { action as gitlabBranchesAction } from './api.gitlab-branches';
import { action as gitlabProjectsAction } from './api.gitlab-projects';
import { action as supabaseAction } from './api.supabase.query';

vi.mock('~/lib/security', () => ({ withSecurity: (handler: unknown) => handler }));

function args(body: unknown, context: unknown = {}): ActionFunctionArgs {
  return {
    request: new Request('https://bolt.invalid/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'test-placeholder' },
      body: JSON.stringify(body),
    }),
    params: {},
    context,
  } as ActionFunctionArgs;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('inherited connector security fixes', () => {
  it('does not return the server GitHub credential through get_token', async () => {
    const response = await githubAction(
      args({ action: 'get_token' }, { cloudflare: { env: { GITHUB_TOKEN: 'test-server-placeholder' } } }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('test-server-placeholder');
  });

  it.each([
    ['projects', gitlabProjectsAction],
    ['branches', gitlabBranchesAction],
  ] as const)('rejects literal loopback GitLab URLs before fetching %s', async (_name, action) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await action(
      args({ token: 'test-placeholder', projectId: 1, gitlabUrl: 'http://127.0.0.1:8210' }),
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits server stack traces from a Supabase transport error response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));

    const response = await supabaseAction(args({ projectId: 'test-project', query: 'select 1' }));
    expect(response.status).toBe(500);

    const body = (await response.json()) as { error: { message: string; stack?: string } };
    expect(body.error.message).toBe('network unavailable');
    expect(body.error).not.toHaveProperty('stack');
  });
});
