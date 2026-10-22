import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('~/lib/persistence/db', () => ({ openDatabase: vi.fn().mockResolvedValue(undefined) }));
vi.mock('~/lib/persistence/chats', () => ({ getAllChats: vi.fn().mockResolvedValue([]) }));
vi.mock('~/lib/stores/theme', async () => {
  const { atom } = await import('nanostores');
  return { themeStore: atom('dark'), setTheme: vi.fn() };
});

import SettingsTab from './SettingsTab';

describe('SettingsTab labels', () => {
  it('associates Language and Timezone labels with their selects', () => {
    render(<SettingsTab />);

    expect(screen.getByLabelText('Langue').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Fuseau horaire').tagName).toBe('SELECT');
  });

  it('names the notifications switch', () => {
    render(<SettingsTab />);

    const switchEl = screen.getByRole('switch', { name: 'Notifications' });
    expect(switchEl).toBeInTheDocument();
  });
});
