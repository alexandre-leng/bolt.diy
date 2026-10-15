import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Regression: a double click on Continue ran next() twice with the same step,
 * both incremented it, and the wizard went past its last screen
 * ("Step 6 of 4" with an empty body).
 */

let resolveMcpSave: (() => void) | undefined;

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
  DEFAULT_AVATARS: ['a'],
  DEFAULT_AVATAR: 'a',
  updateProfile: vi.fn(),
}));

import { FirstRunOnboarding } from './FirstRunOnboarding';

const stepLabel = () => screen.getByText(/Step \d+ of \d+/).textContent;

describe('FirstRunOnboarding step counter', () => {
  beforeEach(() => {
    localStorage.clear();
    resolveMcpSave = undefined;
  });

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

    // Step 3 saves MCP settings asynchronously: clicks during the save are ignored.
    await clickContinueTwice();
    expect(stepLabel()).toBe('Step 3 of 4');

    await act(async () => {
      resolveMcpSave?.();
    });
    expect(stepLabel()).toBe('Step 4 of 4');
  });
});
