import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelSelector } from './ModelSelector';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { ProviderInfo } from '~/types/model';

vi.mock('~/lib/stores/settings', () => ({ LOCAL_PROVIDERS: [] }));

afterEach(() => vi.restoreAllMocks());

const provider = { name: 'OpenAI', staticModels: [] } as unknown as ProviderInfo;
const otherProvider = { name: 'Anthropic', staticModels: [] } as unknown as ProviderInfo;

const models = [
  { name: 'gpt-a', label: 'GPT Alpha', provider: 'OpenAI', maxTokenAllowed: 128000 },
  { name: 'gpt-b', label: 'GPT Beta', provider: 'OpenAI', maxTokenAllowed: 128000 },
  { name: 'claude-x', label: 'Claude X', provider: 'Anthropic', maxTokenAllowed: 200000 },
] as ModelInfo[];

function selectorProps() {
  return {
    model: 'gpt-a',
    setModel: vi.fn(),
    provider,
    setProvider: vi.fn(),
    modelList: models,
    providerList: [provider, otherProvider],
    apiKeys: {},
  };
}

const cases = [
  { label: 'Modèle', search: 'Search models', first: 'GPT Alpha', last: 'GPT Beta' },
  { label: 'Fournisseur', search: 'Search providers', first: 'OpenAI', last: 'Anthropic' },
];

function controlledListbox(control: HTMLElement) {
  const id = control.getAttribute('aria-controls');
  expect(id).toBeTruthy();

  const listbox = document.getElementById(id!);
  expect(listbox).toHaveAttribute('role', 'listbox');

  return listbox!;
}

function activeOption(control: HTMLElement) {
  const id = control.getAttribute('aria-activedescendant');
  expect(id).toBeTruthy();

  const option = document.getElementById(id!);
  expect(option).toHaveAttribute('role', 'option');
  expect(controlledListbox(control)).toContainElement(option);

  return option!;
}

describe.each(cases)('ModelSelector $label accessibility', ({ label, search, first, last }) => {
  it('scopes listbox and option IDs to each selector instance', () => {
    const props = selectorProps();
    render(
      <>
        <ModelSelector {...props} />
        <ModelSelector {...props} />
      </>,
    );

    // Suppress autofocus only here so both instances can coexist for IDREF inspection.
    const focus = vi.spyOn(HTMLInputElement.prototype, 'focus').mockImplementation(() => undefined);
    const triggers = screen.getAllByLabelText(label);
    triggers.forEach((trigger) => fireEvent.click(trigger));

    const inputs = screen.getAllByLabelText(search);
    inputs.forEach((input) => fireEvent.keyDown(input, { key: 'ArrowDown' }));

    const listboxes = triggers.map(controlledListbox);
    expect(listboxes[0].id).not.toBe(listboxes[1].id);

    const options = screen.getAllByRole('option');
    expect(new Set(options.map((option) => option.id)).size).toBe(options.length);
    inputs.forEach((input, index) => expect(listboxes[index]).toContainElement(activeOption(input)));
    focus.mockRestore();
  });

  it('exposes the active descendant on the focused editable combobox, outside its listbox', () => {
    render(<ModelSelector {...selectorProps()} />);

    const trigger = screen.getByRole('button', { name: label });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-controls');
    fireEvent.click(trigger);

    const input = screen.getByRole('combobox', { name: search });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');

    const listbox = controlledListbox(input);
    expect(listbox).toBe(controlledListbox(trigger));
    expect(listbox).not.toContainElement(input);
    expect(listbox).toHaveAccessibleName(label);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeOption(input)).toHaveAccessibleName(first);
    expect(activeOption(input)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(activeOption(input)).toHaveAccessibleName(last);
    expect(activeOption(input)).toHaveAttribute('aria-selected', 'false');
    expect(input).toHaveFocus();
    expect(
      within(listbox)
        .getAllByRole('option')
        .every((option) => option.tabIndex === -1),
    ).toBe(true);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-controls');
    expect(trigger).not.toHaveAttribute('aria-activedescendant');
  });

  it('opens with arrows and restores focus after keyboard selection', async () => {
    const props = selectorProps();
    const user = userEvent.setup();
    render(<ModelSelector {...props} />);

    const trigger = screen.getByRole('button', { name: label });
    trigger.focus();
    await user.keyboard('{ArrowDown}');

    const input = screen.getByRole('combobox', { name: search });
    expect(input).toHaveFocus();
    await user.keyboard('{ArrowUp}{Enter}');
    expect(label === 'Modèle' ? props.setModel : props.setProvider).toHaveBeenCalledWith(
      label === 'Modèle' ? 'gpt-b' : otherProvider,
    );
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when Tab or Shift+Tab leaves, without stealing focus back', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ModelSelector {...selectorProps()} />
        <button>After selector</button>
      </>,
    );

    const trigger = screen.getByRole('button', { name: label });
    await user.click(trigger);
    await user.tab({ shift: true });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    await user.keyboard('{ArrowDown}');
    await user.tab();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
  });

  it('toggles closed when the trigger is clicked again', async () => {
    const user = userEvent.setup();
    render(<ModelSelector {...selectorProps()} />);

    const trigger = screen.getByRole('button', { name: label });
    await user.click(trigger);
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('restores trigger focus after pointer selection', async () => {
    const props = selectorProps();
    const user = userEvent.setup();
    render(<ModelSelector {...props} />);

    const trigger = screen.getByRole('button', { name: label });
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: last }));
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

it('does not navigate or select model options hidden by loading', () => {
  const props = selectorProps();
  render(<ModelSelector {...props} modelLoading="all" />);
  fireEvent.click(screen.getByLabelText('Modèle'));

  const input = screen.getByLabelText('Search models');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input).not.toHaveAttribute('aria-activedescendant');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(props.setModel).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Modèle' })).toHaveAttribute('aria-expanded', 'true');
});

it('keeps the free-model filter keyboard-operable without selecting a model', async () => {
  const props = selectorProps();
  const openRouter = { ...provider, name: 'OpenRouter' };
  const user = userEvent.setup();
  render(<ModelSelector {...props} provider={openRouter} providerList={[openRouter]} />);
  await user.click(screen.getByLabelText('Modèle'));
  await user.tab({ shift: true });

  const filter = screen.getByRole('button', { name: 'Free models only' });
  expect(filter).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(filter).toHaveAttribute('aria-pressed', 'true');
  expect(props.setModel).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Modèle' })).toHaveAttribute('aria-expanded', 'true');
});
