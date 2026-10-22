import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMCPStore } from './mcp';

beforeEach(() => {
  localStorage.clear();
  useMCPStore.setState({ isInitialized: false, error: null });
});

describe('MCP initialization', () => {
  it('loads saved config locally without POSTing it to the server', async () => {
    localStorage.setItem('mcp_settings', JSON.stringify({ mcpConfig: { mcpServers: { local: { command: 'x' } } } }));

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await useMCPStore.getState().initialize();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useMCPStore.getState().settings.mcpConfig.mcpServers).toHaveProperty('local');
  });
});
