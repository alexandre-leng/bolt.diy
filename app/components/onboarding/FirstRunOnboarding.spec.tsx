import { act, fireEvent, render, screen } from '@testing-library/react';
import Cookies from 'js-cookie';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let resolveMcpSave: (() => void) | undefined;

vi.mock('~/lib/accountSettings', () => ({
  applyAccountPreferences: vi.fn(),
  fetchAccountPreferences: vi.fn(async () => null),
  fetchSecretNames: vi.fn(async () => []),
  pushAccountPreferences: vi.fn(async () => true),
  pushSecrets: vi.fn(async () => true),
  saveOnboardingToAccount: vi.fn(async () => true),
}));
vi.mock('~/lib/stores/theme', () => ({
  themeStore: { get: () => 'dark' },
  setTheme: vi.fn(),
}));
vi.mock('~/utils/constants', () => ({ PROVIDER_LIST: [{ name: 'Test provider' }] }));
vi.mock('~/lib/persistence/db', () => ({
  openDatabase: vi.fn(async () => undefined),
  getAll: vi.fn(async () => []),
}));
vi.mock('~/lib/stores/mcp', () => {
  const state = {
    settings: { mcpConfig: { mcpServers: {} } },
    isInitialized: true,
    initialize: vi.fn(async () => undefined),
    updateSettings: vi.fn(() => new Promise<void>((resolve) => (resolveMcpSave = resolve))),
  };
  const useMCPStore = Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    getState: () => state,
  });

  return { useMCPStore };
});
vi.mock('~/lib/stores/profile', () => ({
  DEFAULT_AVATARS: [
    { id: 'a', name: 'Default', src: 'a' },
    { id: 'b', name: 'Other', src: 'b' },
  ],
  DEFAULT_AVATAR: 'a',
  updateProfile: vi.fn(),
}));

import { FirstRunOnboarding } from './FirstRunOnboarding';
import { pushAccountPreferences, pushSecrets, saveOnboardingToAccount } from '~/lib/accountSettings';
import { openDatabase } from '~/lib/persistence/db';
import { useMCPStore } from '~/lib/stores/mcp';
import { updateProfile } from '~/lib/stores/profile';
import { setTheme } from '~/lib/stores/theme';

const storageSnapshot = () =>
  Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index)!;
      return [key, localStorage.getItem(key)];
    }),
  );

const stepLabel = () => screen.getByText(/Step \d+ of \d+/).textContent;

const continueStep = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Continue|Finish setup/ }));
  });
};
const goToStep = async (step: number) => {
  for (let current = 0; current < step; current++) {
    await continueStep();

    if (current === 2) {
      await act(async () => resolveMcpSave?.());
    }
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Cookies.remove('apiKeys');
  resolveMcpSave = undefined;
});

describe('FirstRunOnboarding step counter', () => {
  it('advances exactly one step per click burst and never past the last step', async () => {
    render(<FirstRunOnboarding />);
    expect(await screen.findByText('Step 1 of 4')).toBeTruthy();

    const clickContinueTwice = async () => {
      const button = screen.getByRole('button', { name: /Continue|Finish setup/ });

      await act(async () => {
        fireEvent.click(button);
        fireEvent.click(button);
      });
    };

    await clickContinueTwice();
    expect(stepLabel()).toBe('Step 2 of 4');
    await clickContinueTwice();
    expect(stepLabel()).toBe('Step 3 of 4');
    await clickContinueTwice();
    expect(stepLabel()).toBe('Step 3 of 4');
    await act(async () => resolveMcpSave?.());
    expect(stepLabel()).toBe('Step 4 of 4');
  });
});

describe('FirstRunOnboarding dismissal', () => {
  it.each([0, 1, 2, 3])('offers Passer on step %i without saving its draft', async (step) => {
    render(<FirstRunOnboarding />);
    await screen.findByText('Step 1 of 4');
    await goToStep(step);

    if (step === 0) {
      fireEvent.change(screen.getByLabelText('What should we call you?'), { target: { value: 'Unsaved name' } });
      fireEvent.click(screen.getByRole('button', { name: 'Use Other avatar' }));
    } else if (step === 1) {
      fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'unsaved-key' } });
    } else if (step === 2) {
      fireEvent.change(screen.getByLabelText('MCP configuration'), { target: { value: 'invalid unsaved JSON' } });
    } else {
      fireEvent.change(screen.getByLabelText('Color theme'), { target: { value: 'light' } });
      fireEvent.change(screen.getByLabelText('Accent intensity'), { target: { value: '80' } });
      fireEvent.click(screen.getByRole('button', { name: 'round' }));
    }

    // Previously confirmed steps may have saved; dismissal must add no settings writes.
    vi.clearAllMocks();

    const storageBefore = storageSnapshot();
    const cookieBefore = Cookies.get('apiKeys');
    const appearanceBefore = document.documentElement.outerHTML;
    fireEvent.click(screen.getByRole('button', { name: 'Passer' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(storageSnapshot()).toEqual({ ...storageBefore, bolt_onboarding_completed: 'true' });
    expect(Cookies.get('apiKeys')).toBe(cookieBefore);
    expect(document.documentElement.dataset.accentIntensity).toBeUndefined();
    expect(setTheme).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(useMCPStore.getState().updateSettings).not.toHaveBeenCalled();
    expect(pushSecrets).not.toHaveBeenCalled();
    expect(saveOnboardingToAccount).not.toHaveBeenCalled();
    expect(pushAccountPreferences).toHaveBeenCalledExactlyOnceWith({ onboardingCompleted: true });

    // Root appearance attributes/styles must not be changed by a draft.
    expect(document.documentElement.outerHTML.split('>')[0]).toBe(appearanceBefore.split('>')[0]);
  });

  it.each([0, 1, 2, 3])('Escape dismisses step %i and persists only the completion flag', async (step) => {
    render(<FirstRunOnboarding />);
    await screen.findByText('Step 1 of 4');
    await goToStep(step);
    vi.clearAllMocks();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('bolt_onboarding_completed')).toBe('true');
    expect(pushAccountPreferences).toHaveBeenCalledExactlyOnceWith({ onboardingCompleted: true });
    expect(saveOnboardingToAccount).not.toHaveBeenCalled();
    expect(pushSecrets).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(setTheme).not.toHaveBeenCalled();
    expect(useMCPStore.getState().updateSettings).not.toHaveBeenCalled();
  });

  it('stays dismissed after remount with the local completion flag', async () => {
    const first = render(<FirstRunOnboarding />);
    await screen.findByText('Step 1 of 4');
    fireEvent.click(screen.getByRole('button', { name: 'Passer' }));
    first.unmount();
    vi.clearAllMocks();

    await act(async () => {
      render(<FirstRunOnboarding />);
    });
    expect(localStorage.getItem('bolt_onboarding_completed')).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(openDatabase).not.toHaveBeenCalled();
    expect(saveOnboardingToAccount).not.toHaveBeenCalled();
    expect(pushAccountPreferences).not.toHaveBeenCalled();
  });

  it('preserves the normal completed path including full account sync', async () => {
    render(<FirstRunOnboarding />);
    await screen.findByText('Step 1 of 4');
    fireEvent.change(screen.getByLabelText('What should we call you?'), { target: { value: 'Saved name' } });
    await goToStep(3);
    await continueStep();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(updateProfile).toHaveBeenCalledWith({ username: 'Saved name', avatar: 'a' });
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(localStorage.getItem('bolt_interface_options')).not.toBeNull();
    expect(localStorage.getItem('bolt_onboarding_completed')).toBe('true');
    expect(saveOnboardingToAccount).toHaveBeenCalledOnce();
    expect(pushAccountPreferences).not.toHaveBeenCalled();
  });
});
