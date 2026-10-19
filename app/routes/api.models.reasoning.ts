import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { LLMManager } from '~/lib/modules/llm/manager';
import { opencodeGoCanDisableThinking, opencodeGoEfforts } from '~/lib/modules/llm/providers/opencode-go';
import { withSecurity } from '~/lib/security';

/*
 * Reasoning levels a model accepts, and whether "off" is offered for it.
 *
 * The composer hides the reasoning row when it knows no level for the selected model, and the
 * client bundle only carries the catalog of models THIS build lists: a provider whose levels come
 * from wherever its key lives published nothing, so the row was absent for a model that does
 * accept levels. The server is the only party that can answer — it reads the same generated
 * catalog and it owns the provider key, which is never handed to the browser.
 *
 * Answers `{ efforts: [], canDisable: true, known: false }` for a model the catalog does not list,
 * which keeps the client's own fallback in charge instead of hiding the control on a guess.
 */
async function reasoningLoader({ request, context }: { request: Request; context: any }) {
  const url = new URL(request.url);
  const model = url.searchParams.get('model');
  const providerName = url.searchParams.get('provider');

  if (!model || !providerName) {
    return Response.json({ error: 'model and provider are required' }, { status: 400 });
  }

  const llmManager = LLMManager.getInstance(context?.cloudflare?.env);
  const provider = llmManager.getProvider(providerName);

  if (!provider) {
    return Response.json({ error: 'unknown provider' }, { status: 404 });
  }

  /*
   * Model listing is the provider's job and may reach the network (a local server, an API). It is
   * best effort: an unreachable provider must not break a settings control.
   */
  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const providerSettings = getProviderSettingsFromCookie(cookieHeader);

  let listed: string[] = [];

  try {
    const models = await llmManager.getModelListFromProvider(provider, {
      apiKeys,
      providerSettings,
      serverEnv: context?.cloudflare?.env,
    });

    listed = models.map((entry) => entry.name);
  } catch {
    // Fall through with an empty list: the catalog answer below is still useful.
  }

  const known = listed.length === 0 || listed.includes(model);

  return Response.json({
    model,
    provider: providerName,
    known,
    efforts: known ? opencodeGoEfforts(model) : [],
    canDisable: known ? opencodeGoCanDisableThinking(model) : true,
  });
}

export const loader = withSecurity(reasoningLoader, { allowedMethods: ['GET'] });
