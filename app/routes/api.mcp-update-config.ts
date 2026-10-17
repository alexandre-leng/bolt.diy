import type { ActionFunctionArgs } from 'react-router';
import { withSecurity } from '~/lib/security';
import {
  MCPService,
  assertRemoteServerConfig,
  toPublicServerStatuses,
  type MCPConfig,
} from '~/lib/services/mcpService';
import { validatePublicHttpUrl } from '~/lib/services/webTools.server';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.mcp-update-config');

export const action = withSecurity(mcpUpdateConfigAction, { allowedMethods: ['POST'] });

/**
 * Refuses what would let a client act on the host: a `stdio` server (spawns a command) or
 * an sse/streamable-http URL that targets a private or internal address (SSRF). Returns
 * the first problem, or undefined when the config is acceptable.
 */
function rejectUnsafeServers(config: MCPConfig): string | undefined {
  for (const [serverName, server] of Object.entries(config.mcpServers ?? {})) {
    try {
      assertRemoteServerConfig(serverName, server);
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid MCP server configuration';
    }

    try {
      validatePublicHttpUrl((server as { url: string }).url);
    } catch (error) {
      return `Server "${serverName}": ${error instanceof Error ? error.message : 'invalid URL'}`;
    }
  }

  return undefined;
}

async function mcpUpdateConfigAction({ request }: ActionFunctionArgs) {
  try {
    const mcpConfig = (await request.json()) as MCPConfig;

    if (
      !mcpConfig ||
      typeof mcpConfig !== 'object' ||
      (mcpConfig.mcpServers !== undefined &&
        (typeof mcpConfig.mcpServers !== 'object' || mcpConfig.mcpServers === null))
    ) {
      return Response.json({ error: 'Invalid MCP servers configuration' }, { status: 400 });
    }

    const rejection = rejectUnsafeServers(mcpConfig);

    if (rejection) {
      return Response.json({ error: rejection }, { status: 400 });
    }

    const mcpService = MCPService.getInstance();
    const serverTools = await mcpService.updateConfig(mcpConfig);

    return Response.json(toPublicServerStatuses(serverTools));
  } catch (error) {
    logger.error('Error updating MCP config:', error);
    return Response.json({ error: 'Failed to update MCP config' }, { status: 500 });
  }
}
