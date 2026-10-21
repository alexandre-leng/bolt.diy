import type { LoaderFunction } from 'react-router';
import { resolveProviderKeys } from '~/lib/.server/api/instance-keys';
import { getApiKeysFromCookie } from '~/lib/api/cookies';
import { LLMManager } from '~/lib/modules/llm/manager';

export const loader: LoaderFunction = async ({ context, request }) => {
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider');

  if (!provider) {
    return Response.json({ isSet: false });
  }

  const llmManager = LLMManager.getInstance(context?.cloudflare?.env as any);
  const providerInstance = llmManager.getProvider(provider);

  if (!providerInstance || !providerInstance.config.apiTokenKey) {
    return Response.json({ isSet: false });
  }

  const envVarName = providerInstance.config.apiTokenKey;

  const cookieHeader = request.headers.get('Cookie');
  const cookieApiKeys = getApiKeysFromCookie(cookieHeader);

  /*
   * A key the administrator manages counts as set. The old order read the cookie and the
   * environment only, so a provider configured for everybody still showed "Not Set" and the
   * settings screen invited the user to paste a key that already existed. `managed` lets that
   * screen say "géré par l'administrateur" instead of asking.
   */
  const resolved = await resolveProviderKeys({
    env: context?.cloudflare?.env as unknown as Record<string, unknown>,
    userId: request.headers.get('X-Bolt-User-Id'),
    cookieKeys: cookieApiKeys,
  });

  const apiKeys = { ...cookieApiKeys, ...resolved.apiKeys };
  const managed = resolved.source[provider] === 'instance';

  /*
   * Check API key in order of precedence:
   * 1. Client-side API keys (from cookies)
   * 2. Server environment variables (from Cloudflare env)
   * 3. Process environment variables (from .env.local)
   * 4. LLMManager environment variables
   */
  const isSet = !!(
    apiKeys?.[provider] ||
    (context?.cloudflare?.env as Record<string, any>)?.[envVarName] ||
    process.env[envVarName] ||
    llmManager.env[envVarName]
  );

  return Response.json({ isSet, managed, userKeyAllowed: resolved.allowUserKeys.includes(provider) });
};
