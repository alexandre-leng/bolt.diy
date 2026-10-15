import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LlmErrorAlert from './LLMApiAlert';

describe('LlmErrorAlert', () => {
  it('offers Continue after a dropped connection', () => {
    const onContinue = vi.fn();
    render(
      <LlmErrorAlert
        alert={{
          type: 'error',
          title: 'Connection lost',
          description: 'x',
          provider: 'OpenCodeGo',
          errorType: 'network',
        }}
        clearAlert={() => undefined}
        onContinue={onContinue}
      />,
    );

    expect(screen.getByText('The reply stopped before it was complete.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('llm-error-continue'));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('does not offer Continue for other errors', () => {
    render(
      <LlmErrorAlert
        alert={{
          type: 'error',
          title: 'Authentication Error',
          description: 'x',
          provider: 'OpenCodeGo',
          errorType: 'authentication',
        }}
        clearAlert={() => undefined}
        onContinue={() => undefined}
      />,
    );

    expect(screen.queryByTestId('llm-error-continue')).toBeNull();
  });
});
