import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCPService } from './mcpService';

describe('MCP config idempotence', () => {
  afterEach(() => vi.restoreAllMocks());
  it('does not reconnect when a config is unchanged', async () => {
    const service = MCPService.getInstance();
    (service as any)._config = { mcpServers: {} };

    const createClients = vi.spyOn(service as any, '_createClients').mockResolvedValue(undefined);
    await service.updateConfig({ mcpServers: {} });
    expect(createClients).not.toHaveBeenCalled();
  });
});
