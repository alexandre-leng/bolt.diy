import { describe, expect, it, vi } from 'vitest';
import { handlePreloadError, isStaleBundleUrl, shouldReloadForStaleChunk, RELOAD_KEY } from './staleChunkReload';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('handlePreloadError', () => {
  it('reloads once when an old chunk is missing after a deploy', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const event = new Event('vite:preloadError', { cancelable: true });

    expect(handlePreloadError(event, storage, reload, 1_000_000)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(storage.getItem(RELOAD_KEY)).toBe('1000000');
  });

  it('does not loop: a second failure within 30 s surfaces the error', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    handlePreloadError(new Event('x', { cancelable: true }), storage, reload, 1_000_000);

    const again = new Event('vite:preloadError', { cancelable: true });
    expect(handlePreloadError(again, storage, reload, 1_010_000)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
    expect(again.defaultPrevented).toBe(false);
  });

  it('reloads again after the guard window', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    handlePreloadError(new Event('x', { cancelable: true }), storage, reload, 1_000_000);
    handlePreloadError(new Event('x', { cancelable: true }), storage, reload, 1_040_000);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe('isStaleBundleUrl', () => {
  it('flags a 404 on a hashed bundle, the stale-tab signature', () => {
    expect(isStaleBundleUrl('/assets/Workbench.client-CoyM9RHm.js', 404)).toBe(true);
    expect(isStaleBundleUrl('https://bolt.example/assets/workbench-CQL6wJfX.js?v=1', 404)).toBe(true);
  });

  it('ignores 200s, other paths and non-bundle requests', () => {
    expect(isStaleBundleUrl('/assets/workbench-CQL6wJfX.js', 200)).toBe(false);
    expect(isStaleBundleUrl('/api/chat', 404)).toBe(false);
    expect(isStaleBundleUrl('/assets/logo.png', 404)).toBe(false);
  });
});

describe('shouldReloadForStaleChunk', () => {
  it('reloads once then holds off inside the guard window', () => {
    const storage = memoryStorage();
    expect(shouldReloadForStaleChunk(storage, 2_000_000)).toBe(true);
    expect(shouldReloadForStaleChunk(storage, 2_010_000)).toBe(false);
    expect(shouldReloadForStaleChunk(storage, 2_031_000)).toBe(true);
  });
});
