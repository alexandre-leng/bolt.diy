import { afterEach, describe, expect, it, vi } from 'vitest';
import { loader as mcpCheck } from './api.mcp-check';
import { action as mcpUpdateConfig } from './api.mcp-update-config';
import { MCPService } from '~/lib/services/mcpService';

const context = { clientAddress: '203.0.113.7' };

function call(handler: typeof mcpCheck | typeof mcpUpdateConfig, request: Request) {
  return handler({ request, context, params: {} } as never);
}

function post(body: unknown) {
  return new Request('https://bolt.example/api/mcp-update-config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('MCP routes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('/api/mcp-check returns status and tool metadata, never the config secrets or the client', async () => {
    vi.spyOn(MCPService.getInstance(), 'checkServersAvailabilities').mockResolvedValue({
      remote: {
        status: 'available',
        client: { serverName: 'remote', close: vi.fn(), tools: vi.fn(), token: 'CLIENT-SECRET' } as never,
        tools: {
          lookup: { description: 'Look it up', inputSchema: { jsonSchema: { type: 'object' } }, execute: vi.fn() },
        } as never,
        config: {
          type: 'sse',
          url: 'https://mcp.example/sse?key=URL-SECRET',
          headers: { Authorization: 'HDR-SECRET' },
        },
      },
      broken: {
        status: 'unavailable',
        error: 'could not connect to server',
        client: null,
        config: { type: 'streamable-http', url: 'https://x.example/mcp', headers: { 'x-api-key': 'HDR2-SECRET' } },
      },
    });

    const response = await call(mcpCheck, new Request('https://bolt.example/api/mcp-check'));
    const text = await response.text();

    // Before: the raw map, headers and URL tokens included, went to every signed-in user.
    expect(text).not.toMatch(/SECRET/);
    expect(JSON.parse(text)).toEqual({
      remote: {
        status: 'available',
        tools: { lookup: { description: 'Look it up', inputSchema: { jsonSchema: { type: 'object' } } } },
        config: { type: 'sse' },
      },
      broken: {
        status: 'unavailable',
        tools: {},
        error: 'could not connect to server',
        config: { type: 'streamable-http' },
      },
    });
  });

  it('/api/mcp-update-config refuses stdio servers (host command execution)', async () => {
    const update = vi.spyOn(MCPService.getInstance(), 'updateConfig').mockResolvedValue({});

    const response = await call(
      mcpUpdateConfig,
      post({ mcpServers: { shell: { type: 'stdio', command: 'sh', args: ['-c', 'id'] } } }),
    );

    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('/api/mcp-update-config refuses URLs on private or internal hosts', async () => {
    const update = vi.spyOn(MCPService.getInstance(), 'updateConfig').mockResolvedValue({});

    for (const url of ['http://host.docker.internal:8210/mcp', 'http://127.0.0.1:8200/sse', 'http://bolt-history/']) {
      const response = await call(mcpUpdateConfig, post({ mcpServers: { s: { type: 'sse', url } } }));
      expect(response.status, url).toBe(400);
    }

    expect(update).not.toHaveBeenCalled();
  });

  it('/api/mcp-update-config accepts a public remote server and answers without its secrets', async () => {
    vi.spyOn(MCPService.getInstance(), 'updateConfig').mockResolvedValue({
      remote: {
        status: 'unavailable',
        error: 'could not retrieve tools from server',
        client: null,
        config: { type: 'streamable-http', url: 'https://mcp.example/mcp', headers: { Authorization: 'HDR-SECRET' } },
      },
    });

    const response = await call(
      mcpUpdateConfig,
      post({
        mcpServers: {
          remote: { type: 'streamable-http', url: 'https://mcp.example/mcp', headers: { Authorization: 'HDR-SECRET' } },
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).not.toMatch(/SECRET/);
  });

  it('is wrapped in withSecurity (method check, security headers)', async () => {
    const response = await call(mcpUpdateConfig, new Request('https://bolt.example/api/mcp-update-config'));

    expect(response.status).toBe(405);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
