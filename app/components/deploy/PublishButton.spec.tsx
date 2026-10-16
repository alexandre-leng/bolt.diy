import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishButton } from './PublishButton';
import { workbenchStore } from '~/lib/stores/workbench';

/**
 * Publishing while a snapshot restore is in flight must be impossible.
 *
 * A reopen replays the snapshot through the file store, so for a moment the
 * workbench holds only the template's default files. A publish in that window
 * built and served THAT — an empty "Start prompting to see magic happen" page —
 * under the real project's name. The upgrade path is what a user hits right
 * after reopening a project, so the guard is what keeps a published site from
 * being silently replaced by an empty one.
 */
function setArtifacts(entries: Record<string, { id: string; title: string; closed: boolean }>) {
  const artifacts: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(entries)) {
    artifacts[key] = { ...value, type: 'bundled', runner: undefined };
  }

  (workbenchStore.artifacts as any).set(artifacts as never);
}

describe('PublishButton during a restore', () => {
  beforeEach(() => {
    setArtifacts({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is disabled while the restored-project-setup artifact is open', () => {
    setArtifacts({
      'restored-project-setup': { id: 'restored-project-setup', title: 'Restored Project & Setup', closed: false },
    });

    render(<PublishButton />);

    expect(screen.getByTestId('publish-button')).toBeDisabled();
    expect(screen.getByTestId('publish-button')).toHaveTextContent('Restauration');
  });

  it('is enabled once the restore has finished', () => {
    setArtifacts({
      'restored-project-setup': { id: 'restored-project-setup', title: 'Restored Project & Setup', closed: true },
      'project-pagia': { id: 'project-pagia', title: 'Pagia — landing pages', closed: true },
    });

    render(<PublishButton />);

    expect(screen.getByTestId('publish-button')).toBeEnabled();
    expect(screen.getByTestId('publish-button')).toHaveTextContent('Publier');
  });

  it('is disabled while the agent-file replay artifact is open too', () => {
    setArtifacts({
      'restored-agent-files': { id: 'restored-agent-files', title: 'Restored project files', closed: false },
    });

    render(<PublishButton />);

    expect(screen.getByTestId('publish-button')).toBeDisabled();
  });
});

describe('PublishButton payload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    workbenchStore.files.set({});
    setArtifacts({});
  });

  it('sends binary files apart, as base64, and text files as text', async () => {
    setArtifacts({ 'project-x': { id: 'project-x', title: 'Mon site', closed: true } });
    workbenchStore.files.set({
      '/home/project/index.html': { type: 'file', content: '<img src="logo.png">', isBinary: false },
      '/home/project/public/logo.png': { type: 'file', content: 'iVBORw0KGgo=', isBinary: true },
      '/home/project/public/huge.mp4': { type: 'file', content: '', isBinary: true },
    } as never);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'stop' }), { status: 500 }));

    render(<PublishButton />);
    fireEvent.click(screen.getByTestId('publish-button'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.files).toEqual({ '/home/project/index.html': '<img src="logo.png">' });

    // Before: the PNG's base64 text was sent in `files` and written as a text file.
    expect(body.binaryFiles).toEqual({ '/home/project/public/logo.png': 'iVBORw0KGgo=' });
  });
});
