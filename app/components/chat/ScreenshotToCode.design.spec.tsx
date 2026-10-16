import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScreenshotToCode } from './ScreenshotToCode';

describe('ScreenshotToCode uses Bolt design tokens and primitives', () => {
  it('renders the file input and actions with Bolt primitives, not bare elements', () => {
    const { container } = render(<ScreenshotToCode generate={async () => ''} importCode={async () => ''} />);

    const input = screen.getByLabelText('Screenshot image');
    expect(input.className).toContain('bg-bolt-elements-background');
    expect(input.className).toContain('border-bolt-elements-border');

    const generate = screen.getByRole('button', { name: 'Generate HTML' });
    expect(generate.className).toContain('inline-flex');
    expect(generate.className).toContain('rounded-md');

    const label = container.querySelector('label[for="screenshot-image"]');
    expect(label?.className).toContain('text-sm');
    expect(label?.className).toContain('font-medium');
  });
});

describe('ScreenshotToCode primary action follows the Bolt primary button tokens', () => {
  it('uses the primary accent for Generate HTML and a styled file trigger', () => {
    render(<ScreenshotToCode generate={async () => ''} importCode={async () => ''} />);

    const generate = screen.getByRole('button', { name: 'Generate HTML' });
    expect(generate.className).toContain('bg-bolt-elements-button-primary-background');
    expect(generate.className).toContain('hover:bg-bolt-elements-button-primary-backgroundHover');
    expect(generate.className).toContain('!rounded-full');

    const input = screen.getByLabelText('Screenshot image');
    expect(input.className).toContain('rounded-full');
  });
});
