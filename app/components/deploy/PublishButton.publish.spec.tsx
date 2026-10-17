import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishButton } from './PublishButton';
import { chatId } from '~/lib/persistence';
import { workbenchStore } from '~/lib/stores/workbench';

/*
 * Publish robustness (audit U5, U6).
 */
function setProject(title: string) {
  (workbenchStore.artifacts as any).set({
    [`project-${title}`]: { id: `project-${title}`, title, closed: true, type: 'bundled', runner: undefined },
  });
}

beforeEach(() => {
  setProject('Site A');
  workbenchStore.files.set({
    '/home/project/index.html': { type: 'file', content: '<h1>A</h1>', isBinary: false },
  } as never);
  chatId.set('chat-A');
});

afterEach(() => {
  vi.restoreAllMocks();
  workbenchStore.files.set({});
  (workbenchStore.artifacts as any).set({});
  chatId.set(undefined);
});

describe('PublishButton: switching chats during the build (U5)', () => {
  it('records the project under the chat and name it was published from', async () => {
    let finishBuild!: (response: Response) => void;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (String(input) === '/api/publish') {
        return new Promise<Response>((resolve) => (finishBuild = resolve));
      }

      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    render(<PublishButton />);
    fireEvent.click(screen.getByTestId('publish-button'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // The user opens another conversation while the server builds.
    act(() => {
      chatId.set('chat-B');
      setProject('Site B');
    });

    await act(async () => {
      finishBuild(new Response(JSON.stringify({ ok: true, url: 'https://x/container/site-a/', slug: 'site-a' })));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const record = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(record).toMatchObject({ name: 'Site A', chatId: 'chat-A' });
  });
});

describe('PublishButton: non-JSON error pages (U6)', () => {
  it.each([
    [401, /Session expirée/],
    [413, /trop volumineux/],
    [502, /indisponible/],
  ])('maps an HTML %i to a French message, never a JSON.parse error', async (status, message) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>nginx</body></html>', { status, headers: { 'Content-Type': 'text/html' } }),
    );

    render(<PublishButton />);
    fireEvent.click(screen.getByTestId('publish-button'));

    const error = await screen.findByTestId('publish-error');
    expect(error.textContent).toMatch(message);
    expect(error.textContent).not.toMatch(/JSON/);
  });

  it('keeps the error bounded and lets the user dismiss it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html></html>', { status: 502 }));

    render(<PublishButton />);
    fireEvent.click(screen.getByTestId('publish-button'));

    const error = await screen.findByTestId('publish-error');
    expect(error.className).toContain('truncate');

    fireEvent.click(screen.getByRole('button', { name: 'Fermer le message d’erreur' }));
    expect(screen.queryByTestId('publish-error')).toBeNull();
  });
});
