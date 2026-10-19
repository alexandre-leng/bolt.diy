import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('~/lib/stores/profile', async () => {
  const { atom } = await import('nanostores');
  return {
    profileStore: atom({ username: 'alex', bio: 'hello', avatar: '/a.png' }),
    DEFAULT_AVATARS: [],
    updateProfile: vi.fn(),
  };
});

import ProfileTab from './ProfileTab';

/*
 * The panel wrote to localStorage and toasted "updated" without ever calling the server: the display
 * name was lost on any other device while the user saw a success message. The store-level test below
 * only proves the edit reaches the store, which is exactly why the missing write went unnoticed.
 */
describe('ProfileTab server persistence', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  /*
   * Edit the field and let the 1 s debounce fire, then hand the timers back to real time.
   *
   * `waitFor` polls on a real timer, so leaving fake timers installed makes it hang until the test
   * times out with no assertion ever running: four "Test timed out in 5000ms" and no verdict on the
   * behaviour. Advance the debounce under fake timers, then restore real ones before waiting.
   */
  const editField = (label: RegExp, value: string) => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    vi.advanceTimersByTime(1100);
    vi.useRealTimers();
  };

  const editUsername = (value: string) => editField(/nom d.utilisateur/i, value);

  it('sends the edited name to the server instead of only storing it locally', async () => {
    render(<ProfileTab />);
    editUsername('bob');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe('/api/auth/profile');
    expect(init.method).toBe('PATCH');

    // The wire field is `displayName`, not the local `username`: one place owns that mapping.
    expect(JSON.parse(init.body)).toEqual({ displayName: 'bob' });
  });

  it('does not claim success when the server refuses the change', async () => {
    const { toast } = await import('~/lib/toastify');
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    render(<ProfileTab />);
    editUsername('bob');

    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    // The bug this guards: a failed write still announced "Username updated".
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('still confirms when the server accepted the change', async () => {
    const { toast } = await import('~/lib/toastify');

    render(<ProfileTab />);
    editUsername('bob');

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Username updated'));
  });

  it('only sends the edited field, so the other keeps its stored value', async () => {
    render(<ProfileTab />);
    editField(/biographie/i, 'new bio');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0];

    // A real PATCH: `displayName` is absent, so the accounts service leaves it untouched.
    expect(JSON.parse(init.body)).toEqual({ bio: 'new bio' });
  });
});
