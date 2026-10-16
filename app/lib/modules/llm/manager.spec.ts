import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseProvider } from './base-provider';
import { LLMManager } from './manager';

class FakeProvider extends BaseProvider {
  name = 'FakeProvider';
  staticModels = [];
  config = { apiTokenKey: 'FAKE_API_KEY' };
  getModelInstance(_options: any): any {
    throw new Error('not implemented');
  }
}

describe('LLMManager', () => {
  afterEach(() => vi.restoreAllMocks());

  it('merges cached dynamic models without duplicating static entries', async () => {
    const manager = LLMManager.getInstance({});
    const provider = manager.getProvider('OpenRouter')!;
    const dynamic = { ...provider.staticModels[0], label: 'Current API label', isFree: false };
    vi.spyOn(provider, 'getModelsFromCache').mockReturnValue([dynamic]);

    const models = await manager.getModelListFromProvider(provider, {});
    expect(models.filter((model) => model.name === dynamic.name)).toEqual([dynamic]);
    expect(new Set(models.map((model) => model.name)).size).toBe(models.length);
  });

  it('loads dynamic and static models only for the requested active providers', async () => {
    const manager = LLMManager.getInstance({});
    const active = manager.getProvider('OpenRouter')!;
    const inactive = manager.getProvider('Anthropic')!;
    const activeCache = vi.spyOn(active, 'getModelsFromCache').mockReturnValue([]);
    const inactiveCache = vi.spyOn(inactive, 'getModelsFromCache');

    const models = await manager.updateModelList({ enabledProviderNames: ['OpenRouter'] });
    expect(activeCache).toHaveBeenCalledOnce();
    expect(inactiveCache).not.toHaveBeenCalled();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => model.provider === 'OpenRouter')).toBe(true);

    expect(await manager.updateModelList({ enabledProviderNames: [] })).toEqual([]);
    await manager.updateModelList({ enabledProviderNames: ['OpenRouter'] });
  });

  it('registers providers from the registry on first getInstance', () => {
    const manager = LLMManager.getInstance({});
    const names = manager.getAllProviders().map((p) => p.name);
    expect(names).toContain('OpenRouter');
    expect(names.length).toBeGreaterThan(0);
  });

  it('registers exactly the enabled providers', () => {
    const manager = LLMManager.getInstance({});
    const names = manager.getAllProviders().map((p) => p.name);

    // All 23 providers should now be registered (22 upstream + OpenCodeGo)
    expect(names.sort()).toEqual([
      'AmazonBedrock',
      'Anthropic',
      'Cerebras',
      'Cohere',
      'Deepseek',
      'Fireworks',
      'Github',
      'Google',
      'Groq',
      'HuggingFace',
      'Hyperbolic',
      'LMStudio',
      'Mistral',
      'Moonshot',
      'Ollama',
      'OpenAI',
      'OpenAILike',
      'OpenCodeGo',
      'OpenRouter',
      'Perplexity',
      'Together',
      'Z.ai',
      'xAI',
    ]);
  });

  it('registers all 23 providers including newly restored ones', () => {
    const manager = LLMManager.getInstance({});
    const names = manager.getAllProviders().map((p) => p.name);

    // Verify newly restored providers are registered
    expect(names).toContain('Groq');
    expect(names).toContain('Together');
    expect(names).toContain('Ollama');
    expect(names).toContain('HuggingFace');
    expect(names).toContain('Cohere');
    expect(names).toContain('Mistral');
    expect(names).toContain('OpenCodeGo');
    expect(names.length).toBe(23);
  });

  it('exposes each enabled provider via getProvider', () => {
    const manager = LLMManager.getInstance({});

    for (const name of ['OpenRouter', 'Anthropic', 'OpenAI', 'Google']) {
      expect(manager.getProvider(name)).toBeDefined();
    }
  });

  it('resolves a default provider whatever the registration order', () => {
    const manager = LLMManager.getInstance({});

    /*
     * The deployment picks the default (VITE_DEFAULT_PROVIDER); asserting the literal
     * "OpenRouter" only encoded one deployment's configuration.
     */
    const provider = manager.getDefaultProvider();
    expect(provider).toBeDefined();
    expect(typeof provider.name).toBe('string');
    expect(provider.name.length).toBeGreaterThan(0);
  });

  it('getProvider returns the registered provider', () => {
    const manager = LLMManager.getInstance({});
    expect(manager.getProvider('OpenRouter')).toBeDefined();
    expect(manager.getProvider('DoesNotExist')).toBeUndefined();
  });

  it('registerProvider ignores duplicate provider names', () => {
    const manager = LLMManager.getInstance({});
    const before = manager.getAllProviders().length;
    manager.registerProvider(new FakeProvider() as unknown as BaseProvider);
    manager.registerProvider(new FakeProvider() as unknown as BaseProvider);
    expect(manager.getAllProviders().length).toBe(before + 1);
  });

  it('getModelList contains static models from providers', () => {
    const manager = LLMManager.getInstance({});
    expect(manager.getModelList().length).toBeGreaterThan(0);
  });
});

describe('LLMManager default provider override', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps OpenRouter when VITE_DEFAULT_PROVIDER is unset', () => {
    vi.stubEnv('VITE_DEFAULT_PROVIDER', '');
    expect(LLMManager.getInstance({}).getDefaultProvider().name).toBe('OpenRouter');
  });

  it('uses VITE_DEFAULT_PROVIDER when it names a registered provider', () => {
    vi.stubEnv('VITE_DEFAULT_PROVIDER', 'OpenCodeGo');
    expect(LLMManager.getInstance({}).getDefaultProvider().name).toBe('OpenCodeGo');
  });

  it('ignores an unknown VITE_DEFAULT_PROVIDER', () => {
    vi.stubEnv('VITE_DEFAULT_PROVIDER', 'NoSuchProvider');
    expect(LLMManager.getInstance({}).getDefaultProvider().name).toBe('OpenRouter');
  });
});
