import { describe, expect, it, vi } from 'vitest';
import { LLMManager } from '~/lib/modules/llm/manager';
import { registerModelsDevProviders } from '~/lib/modules/llm/register-models-dev.server';
import { MODELS_DEV_PROVIDERS } from '~/lib/modules/llm/catalogs/models-dev-providers.catalog';

/*
 * The manager is the only place that decides what the picker sees. A provider that is present in
 * the generated table but missing from the registered set is invisible in the UI with no error
 * anywhere, so this asserts the wiring rather than the data.
 */
describe('LLMManager registers the models.dev providers', () => {
  it('registers every generated provider', async () => {
    const manager = LLMManager.getInstance({} as any);

    /* The constructor kicks off registration without awaiting it, so wait for it to land. */
    await vi.waitFor(() => expect(manager.getAllProviders().length).toBeGreaterThan(20));
    registerModelsDevProviders(manager);

    const names = new Set(manager.getAllProviders().map((provider) => provider.name));

    const missing = MODELS_DEV_PROVIDERS.filter((provider) => !names.has(provider.id)).map((provider) => provider.id);

    expect(missing).toEqual([]);
  });

  it('still registers the dedicated classes', async () => {
    const manager = LLMManager.getInstance({} as any);

    await vi.waitFor(() => expect(manager.getAllProviders().length).toBeGreaterThan(20));
    registerModelsDevProviders(manager);

    const names = new Set(manager.getAllProviders().map((provider) => provider.name));

    for (const dedicated of ['OpenAI', 'Anthropic', 'Google', 'OpenCodeGo', 'Z.ai', 'Github']) {
      expect(names.has(dedicated)).toBe(true);
    }
  });
});
