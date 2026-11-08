import { describe, expect, it } from 'vitest';
import { allModelsDevProviders, isModelsDevProvider } from '~/lib/modules/llm/providers/models-dev';
import { MODELS_DEV_PROVIDERS } from '~/lib/modules/llm/catalogs/models-dev-providers.catalog';

describe('models.dev providers', () => {
  it('instantiates every generated provider', () => {
    const all = allModelsDevProviders();
    expect(all.length).toBe(MODELS_DEV_PROVIDERS.length);
  });

  it('exposes a base URL and a key variable per provider', () => {
    const novita = allModelsDevProviders().find((p) => p.name === 'novita-ai');
    expect(novita).toBeDefined();
    expect(novita?.config.baseUrl).toBe('https://api.novita.ai/openai');
    expect(novita?.config.apiTokenKey).toBe('NOVITA_AI_API_KEY');
  });

  it('builds a model list from the generated catalogue', async () => {
    const p = allModelsDevProviders().find((x) => x.name === 'novita-ai')!;
    const models = await p.getDynamicModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0].provider).toBe('novita-ai');
    expect(models[0].maxTokenAllowed).toBeGreaterThan(1000);
  });

  it('never duplicates a dedicated class name', () => {
    expect(isModelsDevProvider('openai')).toBe(false);
    expect(isModelsDevProvider('anthropic')).toBe(false);
    expect(isModelsDevProvider('zai')).toBe(false);
    expect(isModelsDevProvider('novita-ai')).toBe(true);
  });
});
