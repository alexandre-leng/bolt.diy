import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectToolsPill } from './ConnectToolsPill';
import { OPEN_SETTINGS_EVENT } from '~/components/mobile/MobileNav';

describe('ConnectToolsPill', () => {
  it('asks the sidebar to open settings on the Connectors tab', async () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_SETTINGS_EVENT, listener);
    render(<ConnectToolsPill />);

    await userEvent.click(screen.getByRole('button', { name: 'Connecter vos outils' }));

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ tab: 'connectors' });
    window.removeEventListener(OPEN_SETTINGS_EVENT, listener);
  });
});
