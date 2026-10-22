import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConnectionStatus } from './useConnectionStatus';

vi.mock('~/lib/api/connection', () => ({ checkConnection: vi.fn(async () => ({ connected: true, latency: 20 })) }));

describe('useConnectionStatus', () => {
  afterEach(() => vi.useRealTimers());
  it('does not poll while hidden and stops polling on blur', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });

    const { unmount } = renderHook(() => useConnectionStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    const { checkConnection } = await import('~/lib/api/connection');
    expect(checkConnection).not.toHaveBeenCalled();
    unmount();
  });
});
