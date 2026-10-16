import { render, screen } from '@testing-library/react';
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
});
