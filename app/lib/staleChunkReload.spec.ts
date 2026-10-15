import { describe, expect, it, vi } from 'vitest';
import { handlePreloadError, RELOAD_KEY } from './staleChunkReload';

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
