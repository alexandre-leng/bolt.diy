import type { LoaderFunction } from 'react-router';

import { resolveProviderKeys } from '~/lib/.server/api/instance-keys';

/**
 * What the signed-in account may use, for the composer and the "Mon accès IA" panel.
 *
 * This is the readable half of the model policy: which providers are open, which models each
 * one offers, and whether the effort setting is the user's business. It deliberately carries
 * NO key and no base URL: those live in `instance-keys.ts` and are spent server-side only.
 * A provider's `configured` flag says whether a working key exists somewhere (instance, the
 * user's own cookie, or the environment), because a provider that is open but has no key
 * would otherwise look ready and fail on the first message.
 */
export const loader: LoaderFunction = async ({ context, request }) => {
  const env = context?.cloudflare?.env as unknown as Record<string, unknown>;

  const resolved = await resolveProviderKeys({
    env,
    userId: request.headers.get('X-Bolt-User-Id'),
  });

  const policy = resolved.policy;

  return Response.json({
    managedMode: policy.managedMode,
    defaultModel: policy.defaultModel,
    effortPolicy: policy.effortPolicy,
    allowedProviders: policy.allowedProviders,
    allowedModels: policy.allowedModels,
    userKeyProviders: resolved.allowUserKeys,
    providers: Object.fromEntries(
      Object.keys(resolved.apiKeys).map((provider) => [provider, resolved.source[provider] === 'instance']),
    ),
  });
};
