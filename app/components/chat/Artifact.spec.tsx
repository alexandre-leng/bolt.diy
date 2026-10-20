import { act, render } from '@testing-library/react';
import { map } from 'nanostores';
import { describe, expect, it, vi } from 'vitest';
import { Artifact } from './Artifact';
import type { ArtifactState } from '~/lib/stores/workbench';

/*
 * Hoisted above the imports, and nanostores is imported inside it because the
 * factory runs before the file's own imports are initialised.
 */
const { artifacts } = await vi.hoisted(async () => {
  const { map } = await import('nanostores');

  return { artifacts: map<Record<string, unknown>>({}) };
});

/*
 * `~/lib/stores/workbench` reads `import.meta.hot.data`, which vitest does not
 * provide, so only the members this component touches are stubbed.
 */
vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: {
    artifacts,
    showWorkbench: { get: () => false, set: vi.fn() },
    currentView: { get: () => 'code', set: vi.fn() },
    setSelectedFile: vi.fn(),
  },
}));

function artifactState(id: string, title: string) {
  return {
    id,
    title,
    closed: true,

    // Not bundled, so the title is rendered as-is instead of the setup status.
    type: 'text',
    runner: { actions: map({}) },
  } as unknown as ArtifactState;
}

describe('Artifact', () => {
  /*
   * The artifact id is parsed out of the rendered message text, while the
   * artifacts map is filled by a parse pass that runs after render. They are out
   * of step for a render or two whenever the workbench is emptied, e.g. when
   * another chat is opened, and that must not take the tree down.
   */
  it('should render nothing when the workbench has no entry for the id yet', () => {
    artifacts.set({});

    const { container } = render(<Artifact messageId="message-1" artifactId="artifact-1" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('should render the artifact once its entry arrives', () => {
    artifacts.set({ 'artifact-1': artifactState('artifact-1', 'Project A') });

    const { container } = render(<Artifact messageId="message-1" artifactId="artifact-1" />);

    expect(container).toHaveTextContent('Project A');
  });

  it('should survive its entry being emptied out from under it', () => {
    const { rerender, container } = render(<Artifact messageId="message-1" artifactId="artifact-1" />);

    act(() => {
      artifacts.set({ 'artifact-1': artifactState('artifact-1', 'Project A') });
    });
    rerender(<Artifact messageId="message-1" artifactId="artifact-1" />);

    expect(container).toHaveTextContent('Project A');

    // What a chat switch looks like to this component.
    act(() => {
      artifacts.set({});
    });
    rerender(<Artifact messageId="message-1" artifactId="artifact-1" />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['empty', [], 'Project Setup Incomplete', 'No setup actions were generated.'],
    ['failed', [{ type: 'shell', status: 'failed' }], 'Project Setup Failed', 'One or more setup actions failed.'],
    ['aborted', [{ type: 'file', status: 'aborted' }], 'Project Setup Incomplete', 'Project setup was interrupted.'],
  ])(
    'shows a terminal setup status for %s artifacts instead of an endless spinner',
    (_name, actions, title, detail) => {
      artifacts.set({
        setup: {
          id: 'setup',
          title: 'Create initial files',
          type: 'bundled',
          closed: true,
          runner: { actions: map(Object.fromEntries(actions.map((action, index) => [String(index), action]))) },
        },
      });

      const { container } = render(<Artifact messageId="message" artifactId="setup" />);

      expect(container).toHaveTextContent(title);
      expect(container).toHaveTextContent(detail);
      expect(container).not.toHaveTextContent('Creating Project...');
      expect(container.getElementsByClassName('i-svg-spinners:90-ring-with-bg')).toHaveLength(0);
    },
  );

  /*
   * A restore artifact is Bolt's own synthetic message: on a reopened chat it added a "Project Setup
   * Incomplete" card above the conversation, describing a setup the user never started. It writes
   * real files and starts the server, so it must keep running — only its card disappears.
   */
  it.each([['restored-project-setup'], ['restored-agent-files']])(
    'renders no card for %s but keeps its actions registered',
    (id) => {
      const actions = map<Record<string, unknown>>({
        write: { type: 'file', status: 'complete' },
        server: { type: 'start', status: 'running' },
      });

      artifacts.set({
        [id]: { id, title: 'Restored Project & Setup', type: 'bundled', closed: true, runner: { actions } },
      });

      const { container } = render(<Artifact messageId="message" artifactId={id} />);

      expect(container).toBeEmptyDOMElement();
      expect(actions.get().server).toBeDefined();
    },
  );

  /*
   * Reopening the chat on the device that built the project hit the other order: the card was still
   * drawn in the window where the artifacts map had not caught up with the parsed message, and it
   * announced "Project Setup Incomplete" for a setup nobody had started.
   */
  /*
   * The real path: the parser is told not to emit the element at all for a `hidden` artifact, which
   * covers the card drawn before the workbench map caught up AND the ones already in a stored
   * message from an older build. Its actions still run, that is the whole point of the artifact.
   */
  it('does not emit the card of a hidden artifact but still runs its actions', async () => {
    const { StreamingMessageParser } = await import('~/lib/runtime/message-parser');
    const actions: string[] = [];

    const parser = new StreamingMessageParser({
      callbacks: {
        onActionClose: (data) => {
          const action = data.action as { type: string; filePath?: string; content?: string };

          actions.push(`${action.type}:${action.filePath ?? action.content}`);
        },
      },
    });

    const parsed = parser.parse(
      'message-hidden',
      '<boltArtifact id="restored-agent-files" title="Restored project files" type="bundled" hidden>\n' +
        '<boltAction type="file" filePath="/home/project/src/App.tsx">a</boltAction>\n' +
        '<boltAction type="start">npm run dev</boltAction>\n</boltArtifact>',
    );

    /* No card element, and the actions are the reason the artifact exists. */
    expect(parsed).toBe('');
    expect(actions).toEqual(['file:/home/project/src/App.tsx', 'start:npm run dev']);
  });

  it('renders no restore card even before its workbench entry exists', () => {
    artifacts.set({});

    const { container } = render(<Artifact messageId="message" artifactId="restored-project-setup" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps queued setup actions loading until they finish, including a running dev server', () => {
    const actions = map<Record<string, unknown>>({ install: { type: 'shell', status: 'pending' } });
    artifacts.set({
      setup: { id: 'setup', title: 'Setup', type: 'bundled', closed: true, runner: { actions } },
    });

    const { container } = render(<Artifact messageId="message" artifactId="setup" />);
    expect(container).toHaveTextContent('Creating Project...');

    act(() => {
      actions.set({ install: { type: 'shell', status: 'complete' }, server: { type: 'start', status: 'running' } });
    });

    expect(container).toHaveTextContent('Project Created');
    expect(container).toHaveTextContent('Initial files created');
    expect(container.getElementsByClassName('i-svg-spinners:90-ring-with-bg')).toHaveLength(0);
  });
});
