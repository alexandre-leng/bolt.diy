import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelSelector } from './ModelSelector';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { ProviderInfo } from '~/types/model';

/*
 * Accessibility and keyboard regressions for the model/provider comboboxes.
 * Provider settings and the reasoning-effort catalog are stubbed: these tests cover ARIA wiring
 * and focus management only, not provider logic.
 */
vi.mock('~/lib/hooks/useSettings', () => ({
  useSettings: () => ({ providers: {}, updateProviderSettings: vi.fn() }),
}));
vi.mock('~/lib/modules/llm/providers/opencode-go', () => ({
  opencodeGoEfforts: () => [],
  opencodeGoCanDisableThinking: () => false,
}));

const provider = { name: 'OpenAI', staticModels: [] } as unknown as ProviderInfo;
const otherProvider = { name: 'Anthropic', staticModels: [] } as unknown as ProviderInfo;

const models: ModelInfo[] = [
  { name: 'gpt-a', label: 'GPT Alpha', provider: 'OpenAI', maxTokenAllowed: 128000 },
  { name: 'gpt-b', label: 'GPT Beta', provider: 'OpenAI', maxTokenAllowed: 128000 },
  { name: 'claude-x', label: 'Claude X', provider: 'Anthropic', maxTokenAllowed: 200000 },
] as unknown as ModelInfo[];

function renderSelector(overrides: Record<string, unknown> = {}) {
  const props = {
    model: 'gpt-a',
    setModel: vi.fn(),
    provider,
    setProvider: vi.fn(),
    modelList: models,
    providerList: [provider, otherProvider],
    apiKeys: {},
    modelLoading: undefined,
    ...overrides,
  };

  render(<ModelSelector {...(props as any)} />);

  return props;
}

const modelTrigger = () => screen.getByRole('combobox', { name: 'Modèle' });
const providerTrigger = () => screen.getByRole('combobox', { name: 'Fournisseur' });

describe('ModelSelector accessibility', () => {
  it('names both comboboxes and exposes no active descendant while closed', () => {
    renderSelector();

    expect(modelTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(modelTrigger()).not.toHaveAttribute('aria-activedescendant');
    expect(modelTrigger()).not.toHaveAttribute('aria-controls');
    expect(providerTrigger()).not.toHaveAttribute('aria-activedescendant');
  });

  it('points aria-activedescendant at the focused model option while navigating', () => {
    renderSelector();

    fireEvent.click(modelTrigger());
    expect(modelTrigger()).toHaveAttribute('aria-controls', 'model-listbox');

    const searchBox = screen.getByRole('searchbox', { name: 'Search models' });
    fireEvent.keyDown(searchBox, { key: 'ArrowDown' });

    expect(modelTrigger()).toHaveAttribute('aria-activedescendant', 'model-option-0');
    expect(document.getElementById('model-option-0')).toHaveAttribute('role', 'option');
  });

  it('gives every option an accessible name', () => {
    renderSelector();
    fireEvent.click(modelTrigger());

    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual(['GPT Alpha', 'GPT Beta']);
  });

  it('restores focus to the model trigger after a click selection', () => {
    const props = renderSelector();
    fireEvent.click(modelTrigger());

    fireEvent.click(screen.getByRole('option', { name: 'GPT Beta' }));

    expect(props.setModel).toHaveBeenCalledWith('gpt-b');
    expect(document.activeElement).toBe(modelTrigger());
  });

  it('restores focus to the model trigger on Escape', () => {
    renderSelector();
    fireEvent.click(modelTrigger());

    const searchBox = screen.getByRole('searchbox', { name: 'Search models' });
    fireEvent.keyDown(searchBox, { key: 'Escape' });

    expect(modelTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(modelTrigger());
  });

  it('restores focus to the provider trigger after a provider selection', () => {
    renderSelector();
    fireEvent.click(providerTrigger());

    fireEvent.click(screen.getByRole('option', { name: 'Anthropic' }));

    expect(providerTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(providerTrigger());
  });
});
