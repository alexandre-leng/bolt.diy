import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CloseButton } from './CloseButton';

describe('CloseButton accessible name', () => {
  it('uses a caller-provided aria-label instead of the generic "Close"', () => {
    render(<CloseButton aria-label="Close screenshot generator" onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Close screenshot generator' })).toBeTruthy();
  });

  it('keeps "Close" as the default name for existing callers', () => {
    render(<CloseButton onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});
