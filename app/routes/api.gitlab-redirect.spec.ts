import { afterEach, describe, expect, it, vi } from 'vitest';
import { action as gitlabBranchesAction } from './api.gitlab-branches';
import { action as gitlabProjectsAction } from './api.gitlab-projects';

/*
 * A `302 Location: http://127.0.0.1:8199/...` from a public-looking GitLab host used to be
 * followed by default (`redirect: 'follow'`), making the server fetch an internal service and
 * relay its body back — and re-sending the caller's `Authorization: Bearer <token>` to the
 * redirect target. Every hop must now be re-validated and the token dropped across hosts.
 */
function post(handler: unknown, body: unknown) {
  const request = new Request('https://bolt.example/api/gitlab', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-Proto': 'https',
      'X-Real-IP': '198.51.100.9',
    },
    body: JSON.stringify(body),
  });

  return (handler as (args: never) => Promise<Response>)({ request, context: {} } as never);
}

describe('gitlab routes: redirects are not followed blindly', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('projects: refuses an internal redirect target without fetching it', async () => {
    const calls: string[] = [];

    const fetchMock = vi.fn(async (url: string | URL) => {
      calls.push(String(url));

      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8199/admin' } });
    });

    vi.stubGlobal('fetch', fetchMock);

    const response = await post(gitlabProjectsAction, {
      token: 'glpat-secret',
      gitlabUrl: 'https://gitlab.example.com',
    });

    // Before: fetch followed to 127.0.0.1:8199 and relayed the body (status 200 here).
    expect(response.status).toBe(500);
    expect(calls.some((c) => c.includes('127.0.0.1'))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('projects: never re-sends the GitLab token to a different redirect host', async () => {
    const seen: Array<Record<string, string>> = [];

    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;

      // Snapshot: the helper mutates the same object across hops (deletes the token).
      seen.push({ ...headers });

      if (seen.length === 1) {
        return new Response(null, { status: 302, headers: { location: 'https://evil.example.net/v4/projects' } });
      }

      return Response.json([]);
    });

    vi.stubGlobal('fetch', fetchMock);

    await post(gitlabProjectsAction, { token: 'glpat-secret', gitlabUrl: 'https://gitlab.example.com' });

    expect(seen.length).toBe(2);
    expect(seen[0].Authorization ?? seen[0].authorization).toMatch(/glpat-secret/);

    // Before: the second request to evil.example.net still carried the caller's token.
    expect(seen[1].Authorization ?? seen[1].authorization).toBeUndefined();
  });

  it('branches: refuses an internal redirect target without fetching it', async () => {
    const calls: string[] = [];

    const fetchMock = vi.fn(async (url: string | URL) => {
      calls.push(String(url));

      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
    });

    vi.stubGlobal('fetch', fetchMock);

    const response = await post(gitlabBranchesAction, {
      token: 'glpat-secret',
      gitlabUrl: 'https://gitlab.example.com',
      projectId: '42',
    });

    expect(response.status).toBe(500);
    expect(calls.some((c) => c.includes('169.254.169.254'))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('branches: drops the token when the second request redirects to another host', async () => {
    const seen: Array<Record<string, string>> = [];

    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;

      // Snapshot: the helper mutates the same object across hops (deletes the token).
      seen.push({ ...headers });

      if (seen.length === 1) {
        return new Response(null, { status: 307, headers: { location: 'https://evil.example.net/branches' } });
      }

      return Response.json([]);
    });

    vi.stubGlobal('fetch', fetchMock);

    await post(gitlabBranchesAction, {
      token: 'glpat-secret',
      gitlabUrl: 'https://gitlab.example.com',
      projectId: '42',
    });

    expect(seen[1].Authorization ?? seen[1].authorization).toBeUndefined();
  });

  it('follows a redirect that stays on the same host', async () => {
    const seen: Array<Record<string, string>> = [];

    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;

      // Snapshot: the helper mutates the same object across hops (deletes the token).
      seen.push({ ...headers });

      if (seen.length === 1) {
        return new Response(null, { status: 302, headers: { location: '/api/v4/projects?page=2' } });
      }

      return Response.json([]);
    });

    vi.stubGlobal('fetch', fetchMock);

    const response = await post(gitlabProjectsAction, {
      token: 'glpat-secret',
      gitlabUrl: 'https://gitlab.example.com',
    });

    expect(response.status).toBe(200);
    expect(seen.length).toBe(2);

    // Same host: the credential is legitimately re-sent.
    expect(seen[1].Authorization ?? seen[1].authorization).toMatch(/glpat-secret/);
  });
});
