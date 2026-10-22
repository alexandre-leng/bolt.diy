import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PortDropdown } from './PortDropdown';

const previews = [
  { port: 8080, ready: true, baseUrl: 'https://p8080.example.test' },
  { port: 3000, ready: true, baseUrl: 'https://p3000.example.test' },
];

describe('PortDropdown', () => {
  it('renders each port as a native keyboard button and selects by port', () => {
    const onSelectPort = vi.fn();
    const setIsDropdownOpen = vi.fn();

    render(
      <PortDropdown
        activePort={8080}
        onSelectPort={onSelectPort}
        isDropdownOpen={true}
        setIsDropdownOpen={setIsDropdownOpen}
        previews={previews}
      />,
    );

    const option = screen.getByRole('button', { name: '3000' });
    expect(option.tagName).toBe('BUTTON');

    fireEvent.click(option);

    expect(onSelectPort).toHaveBeenCalledWith(3000);
    expect(setIsDropdownOpen).toHaveBeenCalledWith(false);
  });
});
