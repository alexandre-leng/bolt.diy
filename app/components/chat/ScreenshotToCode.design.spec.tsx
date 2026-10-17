import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScreenshotToCode } from './ScreenshotToCode';

/** No variants: these tests only inspect the chrome, not a generation. */
const nothing = async () => [];

describe('ScreenshotToCode uses Bolt design tokens and primitives', () => {
  it('renders the file input and actions with Bolt primitives, not bare elements', () => {
    const { container } = render(<ScreenshotToCode generate={nothing} importCode={async () => ''} />);

    const input = screen.getByLabelText('Screenshot image');
    expect(input.className).toContain('bg-bolt-elements-background');
    expect(input.className).toContain('border-bolt-elements-border');

    const generate = screen.getByRole('button', { name: 'Generate design' });
    expect(generate.className).toContain('inline-flex');
    expect(generate.className).toContain('rounded-md');

    const label = container.querySelector('label[for="screenshot-image"]');
    expect(label?.className).toContain('text-sm');
    expect(label?.className).toContain('font-medium');
  });

  it('styles the output stack selector with the same tokens as the rest of the panel', () => {
    render(<ScreenshotToCode generate={nothing} importCode={async () => ''} />);

    const stack = screen.getByLabelText('Output stack');
    expect(stack.className).toContain('bg-bolt-elements-background-depth-1');
    expect(stack.className).toContain('border-bolt-elements-borderColor');
    expect(stack.className).toContain('text-bolt-elements-textPrimary');
  });
});

describe('ScreenshotToCode primary action follows the Bolt primary button tokens', () => {
  it('uses the primary accent for Generate design and a styled file trigger', () => {
    render(<ScreenshotToCode generate={nothing} importCode={async () => ''} />);

    const generate = screen.getByRole('button', { name: 'Generate design' });
    expect(generate.className).toContain('bg-bolt-elements-button-primary-background');
    expect(generate.className).toContain('hover:bg-bolt-elements-button-primary-backgroundHover');
    expect(generate.className).toContain('!rounded-full');

    const input = screen.getByLabelText('Screenshot image');
    expect(input.className).toContain('rounded-full');
  });
});
