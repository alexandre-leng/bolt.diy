import { fireEvent, render, screen } from '@testing-library/react';
import { map } from 'nanostores';
import { describe, expect, it, vi } from 'vitest';
import { Artifact } from './Artifact';
import ThoughtBox from './ThoughtBox';
import type { ArtifactState } from '~/lib/stores/workbench';

const { artifacts, currentView } = await vi.hoisted(async () => {
  const { map } = await import('nanostores');

  return {
    artifacts: map<Record<string, unknown>>({}),
    currentView: { get: () => 'code', set: vi.fn() },
  };
});

vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: {
    artifacts,
    showWorkbench: { get: () => false, set: vi.fn() },
    currentView,
    setSelectedFile: vi.fn(),
  },
}));

function textArtifact(actions: Record<string, unknown>) {
  return {
    id: 'artifact-1',
    title: 'Project A',
    closed: true,
    type: 'text',
    runner: { actions: map(actions) },
  } as unknown as ArtifactState;
}

describe('Artifact keyboard accessibility', () => {
  it('toggles the actions panel through a native button with aria-expanded and aria-controls', () => {
    artifacts.set({
      'artifact-1': textArtifact({ a: { type: 'shell', status: 'complete', content: 'npm install' } }),
    });

    const { container } = render(<Artifact messageId="m" artifactId="artifact-1" />);
    const toggle = screen.getByRole('button', { name: /actions/i });

    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const panelId = toggle.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(container.querySelector(`#${CSS.escape(panelId as string)}`)).not.toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('exposes Start Application as a native button, not a keyboard-inert anchor', () => {
    artifacts.set({
      'artifact-1': textArtifact({ s: { type: 'start', status: 'running', content: 'npm run dev' } }),
    });

    render(<Artifact messageId="m" artifactId="artifact-1" />);
    const start = screen.getByRole('button', { name: 'Start Application' });

    expect(start.tagName).toBe('BUTTON');
    expect(start).toHaveAttribute('type', 'button');
    expect(document.querySelector('a')).toBeNull();
  });

  it('exposes file paths as native buttons that open the file', () => {
    artifacts.set({
      'artifact-1': textArtifact({ f: { type: 'file', status: 'complete', filePath: 'src/App.tsx', content: '' } }),
    });

    render(<Artifact messageId="m" artifactId="artifact-1" />);
    const file = screen.getByRole('button', { name: 'src/App.tsx' });

    expect(file.tagName).toBe('BUTTON');
    expect(file).toHaveAttribute('type', 'button');
  });
});

describe('ThoughtBox native collapse', () => {
  it('uses a native button header with aria-expanded and keeps collapsed content out of the tab order', () => {
    render(
      <ThoughtBox title="Thought process">
        <a href="https://example.com">inner link</a>
      </ThoughtBox>,
    );

    const header = screen.getByRole('button', { name: /Thought process/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');

    // Collapsed: the hidden panel must not expose its link to focus or AT.
    expect(screen.queryByRole('link', { name: 'inner link' })).toBeNull();

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'inner link' })).toBeVisible();
  });

  it('toggles from the keyboard via the native button without a click-only wrapper', () => {
    render(
      <ThoughtBox title="Thought process">
        <span>body</span>
      </ThoughtBox>,
    );

    const header = screen.getByRole('button', { name: /Thought process/ });
    expect(header.closest('[onclick]')).toBeNull();

    header.focus();
    expect(document.activeElement).toBe(header);
  });
});
