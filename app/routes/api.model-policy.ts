import type { LoaderFunction } from 'react-router';

import { policyUnavailableResponse, resolveProviderKeys } from '~/lib/.server/api/instance-keys';
import { LLMManager } from '~/lib/modules/llm/manager';

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

  const policyUnavailable = policyUnavailableResponse(resolved);

  if (policyUnavailable) {
    return policyUnavailable;
  }

  const policy = resolved.policy;

  /*
   * With no policy in force, every registered provider is open in principle: what decides is
   * whether a key exists. Sending `allowedProviders: []` there made the panel say "aucun
   * fournisseur ne vous est ouvert" on an instance that works, which is a lie the user cannot
   * debug. With a managed policy, the admin's list is the answer and nothing is added.
   */
  const allProviders = LLMManager.getInstance(context?.cloudflare?.env as any)
    .getAllProviders()
    .map((provider) => provider.name);

  const readableProviders = policy.managedMode
    ? policy.allowedProviders
    : resolved.allowUserKeys.length > 0
      ? [...new Set([...resolved.allowUserKeys, ...Object.keys(resolved.apiKeys)])]
      : allProviders;

  return Response.json({
    managedMode: policy.managedMode,
    defaultModel: policy.defaultModel,
    effortPolicy: policy.effortPolicy,
    allowedProviders: readableProviders,
    allowedModels: policy.allowedModels,
    userKeyProviders: resolved.allowUserKeys,
    providers: Object.fromEntries(
      Object.keys(resolved.apiKeys).map((provider) => [provider, resolved.source[provider] === 'instance']),
    ),
  });
};
