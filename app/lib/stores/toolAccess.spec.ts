import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * Full access is the default mode: the agent writes, runs and tests project files without
 * stopping for an approval click, as in Lovable. The opt-out must survive a reload, so
 * these tests pin both directions rather than only the new default.
 *
 * Runs in the `dom` Vitest project (real localStorage), like sidebar.spec.ts.
 */
const MODE_KEY = 'tool_access_mode';

async function importStore() {
  vi.resetModules();

  return import('./toolAccess');
}

describe('toolAccess store', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to full-access when nothing was ever chosen', async () => {
    const { useToolAccessStore } = await importStore();

    expect(useToolAccessStore.getState().mode).toBe('full-access');
  });

  it('honours an explicit opt-out to ask-for-all', async () => {
    localStorage.setItem(MODE_KEY, 'ask-for-all');

    const { useToolAccessStore } = await importStore();

    expect(useToolAccessStore.getState().mode).toBe('ask-for-all');
  });

  it('persists the mode so the choice survives a reload', async () => {
    const { useToolAccessStore } = await importStore();

    useToolAccessStore.getState().setMode('ask-for-all');
    expect(localStorage.getItem(MODE_KEY)).toBe('ask-for-all');

    useToolAccessStore.getState().setMode('full-access');
    expect(localStorage.getItem(MODE_KEY)).toBe('full-access');
  });

  it('falls back to full-access for an unrecognised stored value', async () => {
    localStorage.setItem(MODE_KEY, 'something-else');

    const { useToolAccessStore } = await importStore();

    expect(useToolAccessStore.getState().mode).toBe('full-access');
  });

  it('treats full-access as "no prompts"', async () => {
    const { useToolAccessStore } = await importStore();

    // The tray only renders when this is false, so this IS the auto-accept contract.
    expect(useToolAccessStore.getState().mode === 'full-access').toBe(true);
  });
});
