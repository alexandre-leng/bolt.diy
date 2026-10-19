import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

describe('ProfileTab labels', () => {
  it('names the Username and Bio fields via label association', () => {
    render(<ProfileTab />);

    const username = screen.getByLabelText(/nom d.utilisateur/i);
    const bio = screen.getByLabelText(/biographie/i);

    expect(username.tagName).toBe('INPUT');
    expect(username).toHaveValue('alex');
    expect(bio.tagName).toBe('TEXTAREA');
    expect(bio).toHaveValue('hello');
  });

  it('routes edits to the Username field through its accessible name', async () => {
    const { updateProfile } = await import('~/lib/stores/profile');
    vi.useFakeTimers();
    render(<ProfileTab />);

    fireEvent.change(screen.getByLabelText(/nom d.utilisateur/i), { target: { value: 'bob' } });
    vi.advanceTimersByTime(1100);
    vi.useRealTimers();

    /*
     * The store is mocked (updateProfile does not write back), so the rendered value stays
     * 'alex'. What this test owns is the routing: the edit reaches the store under the right key.
     */
    expect(updateProfile).toHaveBeenCalledWith({ username: 'bob' });
  });
});
