import { withSecurity } from '~/lib/security';
import { MCPService, toPublicServerStatuses } from '~/lib/services/mcpService';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.mcp-check');

export const loader = withSecurity(mcpCheckLoader, { allowedMethods: ['GET'] });

async function mcpCheckLoader() {
  try {
    const mcpService = MCPService.getInstance();
    const serverTools = await mcpService.checkServersAvailabilities();

    // Never the raw map: its `config` carries the servers' headers/env secrets.
    return Response.json(toPublicServerStatuses(serverTools));
  } catch (error) {
    logger.error('Error checking MCP servers:', error);
    return Response.json({ error: 'Failed to check MCP servers' }, { status: 500 });
  }
}
