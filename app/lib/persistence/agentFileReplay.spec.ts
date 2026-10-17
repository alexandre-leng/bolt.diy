import { describe, expect, it } from 'vitest';
import {
  createDeleteActions,
  createEncodedFileActions,
  lastAgentStartCommand,
  messagesContainStartAction,
  replayAgentFileOps,
  toAbsoluteProjectPath,
  touchesDependencies,
} from './agentFileReplay';
import { StreamingMessageParser } from '~/lib/runtime/message-parser';

const STARTER_APP =
  'export default function App() {\n  return <p>Start prompting (or editing) to see magic happen :)</p>;\n}';

const templateImport = {
  id: 'm1',
  role: 'assistant',
  parts: [
    {
      type: 'text',
      text: `Bolt is initializing your project.<boltArtifact id="imported-files" title="T" type="bundled">
<boltAction type="file" filePath="package.json">{"scripts":{"dev":"vite"}}</boltAction>
<boltAction type="file" filePath="src/App.tsx">${STARTER_APP}</boltAction>
</boltArtifact>`,
    },
  ],
};

const write = (path: string, content: string, output: Record<string, unknown> = {}) => ({
  type: 'tool-project_write_file',
  toolCallId: `w-${path}`,
  state: 'output-available',
  input: { path, content, replacementReason: 'x' },
  output: { path, written: true, changed: true, ...output },
});

const patchPart = (path: string, oldText: string, newText: string, output: Record<string, unknown> = {}) => ({
  type: 'tool-project_patch_file',
  toolCallId: `p-${path}-${oldText}`,
  state: 'output-available',
  input: { path, oldText, newText, expectedRevision: 'a'.repeat(64) },
  output: { path, patched: true, changed: true, ...output },
});

describe('replayAgentFileOps', () => {
  it('rebuilds the files an agent turn wrote, over the starter template (the reopened-preview bug)', () => {
    const agentTurn = {
      id: 'm3',
      role: 'assistant',
      parts: [
        write('src/App.tsx', 'export default function App() {\n  return <h1>Pagia</h1>;\n}\n'),
        write('src/components/FAQ.tsx', 'const FAQ = [1];\nexport function FAQ2() { return FAQ; }\n'),
        patchPart('src/components/FAQ.tsx', 'const FAQ = [1];', 'const FAQ_ITEMS = [1];'),
        patchPart('src/components/FAQ.tsx', 'return FAQ;', 'return FAQ_ITEMS;'),
      ],
    };

    const result = replayAgentFileOps([{ id: 'm0', role: 'user', parts: [] }, templateImport, agentTurn]);

    expect(result.hasAgentWrites).toBe(true);
    expect(result.unresolved).toEqual([]);
    expect(result.files['/home/project/src/App.tsx']).toContain('<h1>Pagia</h1>');
    expect(result.files['/home/project/src/components/FAQ.tsx']).toBe(
      'const FAQ_ITEMS = [1];\nexport function FAQ2() { return FAQ_ITEMS; }\n',
    );

    // template-only files are not re-emitted: the parser re-runs their artifact anyway
    expect(result.files['/home/project/package.json']).toBeUndefined();
    expect(result.state['/home/project/package.json']).toContain('"dev"');
  });

  it('ignores failed or denied tool calls', () => {
    const turn = {
      id: 'm3',
      role: 'assistant',
      parts: [
        { ...write('src/App.tsx', 'BAD'), output: { error: 'Read the file first', isError: true } },
        { ...write('src/Other.tsx', 'BAD'), state: 'output-error' },
        { ...write('src/Mcp.tsx', 'BAD'), output: { isError: true, content: [] } },
        patchPart('src/App.tsx', 'never there', 'x', { patched: undefined }),
      ],
    };

    const result = replayAgentFileOps([templateImport, turn]);

    expect(result.hasAgentWrites).toBe(false);
    expect(result.files).toEqual({});
  });

  it('accepts the MCP envelope shape for tool output', () => {
    const turn = {
      id: 'm3',
      role: 'assistant',
      parts: [
        {
          ...write('src/App.tsx', 'OK\n'),
          output: { content: [], structuredContent: { path: 'src/App.tsx', written: true, changed: true } },
        },
      ],
    };

    expect(replayAgentFileOps([turn]).files).toEqual({ '/home/project/src/App.tsx': 'OK\n' });
  });

  it('never guesses a patch whose base is unknown', () => {
    const turn = { id: 'm3', role: 'assistant', parts: [patchPart('src/Unknown.tsx', 'a', 'b')] };
    const result = replayAgentFileOps([turn]);

    expect(result.files).toEqual({});
    expect(result.unresolved).toEqual(['/home/project/src/Unknown.tsx']);
  });

  it('a later full write resolves a path that an unknown patch left unresolved', () => {
    const turn = {
      id: 'm3',
      role: 'assistant',
      parts: [patchPart('src/A.tsx', 'a', 'b'), write('src/A.tsx', 'final\n')],
    };

    expect(replayAgentFileOps([turn]).files).toEqual({ '/home/project/src/A.tsx': 'final\n' });
  });

  it('only reports operations after replayFrom when a snapshot base is given', () => {
    const before = { id: 'm1', role: 'assistant', parts: [write('src/Old.tsx', 'old\n')] };
    const after = { id: 'm2', role: 'assistant', parts: [patchPart('src/App.tsx', 'v1', 'v2')] };

    const result = replayAgentFileOps([before, after], {
      base: { '/home/project/src/App.tsx': 'const v = "v1";\n' },
      replayFrom: 1,
    });

    expect(result.files).toEqual({ '/home/project/src/App.tsx': 'const v = "v2";\n' });
  });

  it('drops deleted files from the result', () => {
    const turn = {
      id: 'm3',
      role: 'assistant',
      parts: [
        write('src/lib/a.ts', 'a\n'),
        {
          type: 'tool-project_delete_path',
          toolCallId: 'd',
          state: 'output-available',
          input: { path: 'src/lib', recursive: true },
          output: { path: 'src/lib', deleted: true },
        },
      ],
    };

    const result = replayAgentFileOps([turn]);

    expect(result.files).toEqual({});
    expect(result.state['/home/project/src/lib/a.ts']).toBeUndefined();
  });

  it('normalizes relative and absolute paths to the same key', () => {
    expect(toAbsoluteProjectPath('src/App.tsx')).toBe('/home/project/src/App.tsx');
    expect(toAbsoluteProjectPath('./src/App.tsx')).toBe('/home/project/src/App.tsx');
    expect(toAbsoluteProjectPath('/home/project/src/App.tsx')).toBe('/home/project/src/App.tsx');
  });

  it('detects whether the conversation already starts the project', () => {
    expect(messagesContainStartAction([templateImport])).toBe(false);
    expect(
      messagesContainStartAction([
        { role: 'assistant', parts: [{ type: 'text', text: '<boltAction type="start">npm run dev</boltAction>' }] },
      ]),
    ).toBe(true);
  });
});

describe('encoded file actions round-trip through the message parser', () => {
  const tricky = [
    'const a = "&lt;div&gt;"; // entity text must stay an entity',
    '```ts',
    'whole-file fences must stay',
    '```',
    'const tag = "</boltAction></boltArtifact>";',
    'unicode: é ✓ 🚀',
    '',
    '',
  ].join('\n');

  it('writes the exact bytes, which the plain form corrupted', () => {
    const closed: Array<{ filePath: string; content: string }> = [];

    const parser = new StreamingMessageParser({
      callbacks: {
        onActionClose: ({ action }) => {
          if (action.type === 'file') {
            closed.push({ filePath: action.filePath, content: action.content });
          }
        },
      },
    });

    parser.parse(
      'msg',
      `<boltArtifact id="x" title="Restored" type="bundled">\n${createEncodedFileActions({
        '/home/project/src/Tricky.tsx': tricky,
      })}\n</boltArtifact>`,
    );

    expect(closed).toEqual([{ filePath: '/home/project/src/Tricky.tsx', content: tricky }]);
  });

  it('documents why: the plain form loses entities (pre-existing parser cleanup)', () => {
    const closed: string[] = [];

    const parser = new StreamingMessageParser({
      callbacks: { onActionClose: ({ action }) => closed.push(action.content) },
    });

    parser.parse(
      'msg2',
      '<boltArtifact id="y" title="t" type="bundled"><boltAction type="file" filePath="a.ts">const a = "&lt;b&gt;";</boltAction></boltArtifact>',
    );

    expect(closed[0]).toBe('const a = "<b>";\n');
  });
});

/*
 * Measured on a real project chat: the project had been built in Agent mode, so its
 * snapshot held 15 file actions and ZERO start/shell actions, and the only thing that
 * ever started the dev server was a `project_run_command` tool call at the very end of
 * the conversation. Tool calls are not re-executed on reopen, so that chat came back with
 * every file present and the terminal sitting at a bare `~/project` prompt.
 */
describe('lastAgentStartCommand', () => {
  const runCommand = (command: string, state = 'output-available') => ({
    role: 'assistant',
    parts: [
      {
        type: 'tool-project_run_command',
        input: { command, purpose: 'run' },
        state,
        output: { output: '', status: 'running', command, purpose: 'run' },
      },
    ],
  });

  it('finds the dev-server command of an agent-built project', () => {
    expect(lastAgentStartCommand([runCommand('npm run dev')])).toBe('npm run dev');
  });

  it('takes the LAST one, the command the project was running when the chat ended', () => {
    const messages = [runCommand('npm run start'), runCommand('npm install'), runCommand('npm run dev')];

    expect(lastAgentStartCommand(messages)).toBe('npm run dev');
  });

  it('ignores commands that do not start a dev server', () => {
    const messages = [runCommand('npm install'), runCommand('npm run build'), runCommand('ls -la')];

    expect(lastAgentStartCommand(messages)).toBeUndefined();
  });

  it('ignores user messages and non-run tools', () => {
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: 'npm run dev' }] },
      {
        role: 'assistant',
        parts: [{ type: 'tool-project_write_file', input: { path: 'a.ts' }, state: 'output-available' }],
      },
    ];

    expect(lastAgentStartCommand(messages)).toBeUndefined();
  });

  it('accepts pnpm, yarn and bun equivalents', () => {
    for (const cmd of ['pnpm dev', 'yarn dev', 'bun run start', 'npm start']) {
      expect(lastAgentStartCommand([runCommand(cmd)])).toBe(cmd);
    }
  });
});

const deletePart = (path: string, output: Record<string, unknown> = { deleted: true }) => ({
  type: 'tool-project_delete_path',
  toolCallId: `d-${path}`,
  state: 'output-available',
  input: { path },
  output: { path, ...output },
});

const artifact = (id: string, body: string) => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text: `<boltArtifact id="a-${id}" title="T" type="bundled">\n${body}\n</boltArtifact>` }],
});

/*
 * P10. A path the agent deleted was only dropped from the replay state: the re-run artifact
 * (or the snapshot) wrote it back and the deleted file reappeared on reopen.
 */
describe('replayAgentFileOps — deletions (P10)', () => {
  it('reports a file the agent deleted so the replay can delete it again', () => {
    const result = replayAgentFileOps([
      artifact('m1', '<boltAction type="file" filePath="src/a.css">a {}</boltAction>'),
      { id: 'm2', role: 'assistant', parts: [deletePart('src/a.css')] },
    ]);

    expect(result.deleted).toEqual(['/home/project/src/a.css']);
    expect(result.state['/home/project/src/a.css']).toBeUndefined();
  });

  it('forgets a deletion that a later write undid, and ignores a failed delete', () => {
    const result = replayAgentFileOps([
      { id: 'm1', role: 'assistant', parts: [deletePart('src/a.css'), write('src/a.css', 'b {}\n')] },
      { id: 'm2', role: 'assistant', parts: [deletePart('src/b.css', { deleted: false })] },
    ]);

    expect(result.deleted).toEqual([]);
  });

  it('keeps a deleted directory only when nothing was recreated inside it', () => {
    const result = replayAgentFileOps([
      { id: 'm1', role: 'assistant', parts: [deletePart('old'), deletePart('src'), write('src/main.ts', 'x\n')] },
    ]);

    expect(result.deleted).toEqual(['/home/project/old']);
  });

  it('reports only deletions in the replayed range when a snapshot is the base', () => {
    const result = replayAgentFileOps(
      [
        { id: 'm1', role: 'assistant', parts: [deletePart('before.css')] },
        { id: 'm2', role: 'assistant', parts: [deletePart('after.css')] },
      ],
      { base: { '/home/project/after.css': 'x' }, replayFrom: 1 },
    );

    expect(result.deleted).toEqual(['/home/project/after.css']);
  });

  it('turns deletions into shell actions, refusing anything outside the project', () => {
    expect(createDeleteActions(['/home/project/src/a.css'])).toBe(
      '<boltAction type="shell">rm -rf "/home/project/src/a.css"</boltAction>',
    );
    expect(createDeleteActions(['/home/project/../etc', '/home/project', '/home/project/a$(x)'])).toBe('');
  });
});

/*
 * P11. The agent rewrote package.json: the replay must install again before restarting.
 */
describe('touchesDependencies (P11)', () => {
  it('is true for a manifest or a lockfile, false otherwise', () => {
    expect(touchesDependencies({ '/home/project/package.json': '{}' })).toBe(true);
    expect(touchesDependencies({ '/home/project/pnpm-lock.yaml': '' })).toBe(true);
    expect(touchesDependencies({ '/home/project/src/App.tsx': '' })).toBe(false);
  });
});

/*
 * P15. The replay base for an artifact file kept the raw model text, while the parser had
 * stripped a whole-file code fence and decoded `&lt;`. A later patch then produced a file
 * with ``` lines, or did not apply at all.
 */
describe('replayAgentFileOps — parser normalisation (P15)', () => {
  it('folds a patch over the fence-stripped, unescaped body the parser wrote', () => {
    const fenced = '```tsx\nconst a = 1;\nexport const b = a &lt; 2;\n```';

    const result = replayAgentFileOps([
      artifact('m1', `<boltAction type="file" filePath="src/b.tsx">${fenced}</boltAction>`),
      { id: 'm2', role: 'assistant', parts: [patchPart('src/b.tsx', 'const a = 1;', 'const a = 3;')] },
    ]);

    expect(result.unresolved).toEqual([]);
    expect(result.files['/home/project/src/b.tsx']).toBe('const a = 3;\nexport const b = a < 2;\n');

    // Exactly what the parser itself writes for that action, before the patch.
    const parsed: string[] = [];

    const parser = new StreamingMessageParser({
      callbacks: { onActionClose: ({ action }) => parsed.push((action as { content: string }).content) },
    });
    parser.parse(
      'm1',
      (
        artifact('m1', `<boltAction type="file" filePath="src/b.tsx">${fenced}</boltAction>`).parts[0] as {
          text: string;
        }
      ).text,
    );
    expect(
      replayAgentFileOps([artifact('m1', `<boltAction type="file" filePath="src/b.tsx">${fenced}</boltAction>`)]).state[
        '/home/project/src/b.tsx'
      ],
    ).toBe(parsed[0]);
  });

  it('leaves a markdown file untouched, like the parser', () => {
    const result = replayAgentFileOps([
      artifact('m1', '<boltAction type="file" filePath="README.md">a &lt; b</boltAction>'),
    ]);

    expect(result.state['/home/project/README.md']).toBe('a &lt; b\n');
  });
});
