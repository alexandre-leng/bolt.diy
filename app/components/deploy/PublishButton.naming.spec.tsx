import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishButton } from './PublishButton';
import { chatId } from '~/lib/persistence';
import { workbenchStore } from '~/lib/stores/workbench';

/*
 * The site's NAME must describe the user's project, never a Bolt-internal artifact.
 *
 * `projectName()` takes the first artifact title it finds after skipping the restore ones. Two
 * other synthetic ids sat outside that skip list and leaked their generic title into the slug:
 *
 *   - `imported-files`, written by a folder/zip import, a starter template or a git clone;
 *   - `User Updated Files`, written by `filesToArtifacts()` when the client pushes edited files
 *     back as an artifact.
 *
 * Measured consequence on the live deployment: republishing a chat whose artifact map held only
 * those produced `/container/restored-project-setup/` and a `projects` row named "Restored
 * Project & Setup", overwriting the site the user expected to update.
 */

function setArtifacts(artifacts: Record<string, { id: string; title: string; closed?: boolean; type?: string }>) {
  const mapped: Record<string, unknown> = {};

  for (const [key, artifact] of Object.entries(artifacts)) {
    mapped[key] = { type: 'bundled', closed: true, runner: undefined, ...artifact };
  }

  (workbenchStore.artifacts as any).set(mapped);
}

const publishBody = vi.fn(() => ({ name: '', chatId: '' }));

function mockFetch() {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    if (String(input) === '/api/publish') {
      const parsed = JSON.parse(String(init?.body ?? '{}'));
      publishBody();
      (publishBody as any).lastName = parsed.name;

      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, url: `/container/${parsed.name}/`, slug: parsed.name })),
      );
    }

    return Promise.resolve(new Response('{}', { status: 200 }));
  });
}

beforeEach(() => {
  workbenchStore.files.set({
    '/home/project/index.html': { type: 'file', content: '<h1>A</h1>', isBinary: false },
  } as never);
  chatId.set('chat-A');
  mockFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
  workbenchStore.files.set({});
  (workbenchStore.artifacts as any).set({});
  chatId.set(undefined);
  (publishBody as any).lastName = undefined;
});

async function publishedName(): Promise<string> {
  render(<PublishButton />);
  fireEvent.click(screen.getByTestId('publish-button'));
  await waitFor(() => expect((publishBody as any).lastName).toBeDefined());

  return (publishBody as any).lastName;
}

describe('PublishButton: the site is named after the project, not a synthetic artifact', () => {
  it('skips `imported-files` from an import or a starter template', async () => {
    setArtifacts({
      'imported-files': { id: 'imported-files', title: 'Imported Files' },
      'project-1': { id: 'project-1', title: 'une page pour un boulanger à marseille' },
    });

    expect(await publishedName()).toContain('une page pour un boulanger');
  });

  it('skips `User Updated Files`', async () => {
    setArtifacts({
      'project-1': { id: 'project-1', title: 'User Updated Files' },
      'project-2': { id: 'project-2', title: 'Cabinet Duchmol' },
    });

    expect(await publishedName()).toBe('Cabinet Duchmol');
  });

  it('still skips the restore artifacts', async () => {
    setArtifacts({
      'restored-project-setup': { id: 'restored-project-setup', title: 'Restored Project & Setup' },
      'restored-agent-files': { id: 'restored-agent-files', title: 'Restored project files' },
      'project-1': { id: 'project-1', title: 'Maison Aurélien' },
    });

    expect(await publishedName()).toBe('Maison Aurélien');
  });

  it('falls back to a neutral name when every artifact is synthetic', async () => {
    setArtifacts({
      'restored-project-setup': { id: 'restored-project-setup', title: 'Restored Project & Setup' },
      'imported-files': { id: 'imported-files', title: 'Imported Files' },
    });

    // Better a neutral slug than one that advertises an internal artifact.
    expect(await publishedName()).toBe('mon-site');
  });
});
