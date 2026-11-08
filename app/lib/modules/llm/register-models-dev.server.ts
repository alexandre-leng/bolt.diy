/**
 * Registers the models.dev providers. SERVER ONLY.
 *
 * WHY A SEPARATE MODULE: `~/utils/constants` builds `PROVIDER_LIST` from `LLMManager` and is
 * imported by React components, so `manager.ts` is part of the BROWSER bundle. Registering the
 * models.dev providers from inside the manager therefore pulled their ~1 MB model catalogue into a
 * client chunk — measured: `models-dev-models.catalog-*.js`, 872 kB, requested by `constants.js`.
 *
 * Splitting the module is what breaks that edge: the manager no longer imports the provider, and
 * the ONLY caller of `registerModelsDevProviders` is `/api/models` (a server route). A bundler
 * follows static imports, not conventions, so it is the import graph — not a runtime guard — that
 * keeps the catalogue off the client.
 */
import type { LLMManager } from '~/lib/modules/llm/manager';
import { allModelsDevProviders } from '~/lib/modules/llm/providers/models-dev';

let done = false;

/**
 * Add every provider from the generated models.dev table to the manager, once.
 *
 * Idempotent and additive: a name already registered (a dedicated class) wins, because a
 * dedicated provider speaks a protocol the generic chat-completions adapter does not (Responses
 * API, Messages API, Gemini).
 */
export function registerModelsDevProviders(manager: LLMManager): void {
  if (done) {
    return;
  }

  done = true;

  for (const provider of allModelsDevProviders()) {
    try {
      manager.registerProvider(provider);
    } catch {
      // registerProvider already logs a duplicate; a failing provider must not break the others.
    }
  }
}
