import { describe, expect, it } from 'vitest';
import {
  annotateTurn,
  buildAgentReplayMessage,
  buildAgentRestoreActions,
  chatSummaryText,
  encodeFileActions,
  latestConversationContext,
  missingTurnContext,
  narrativeSegments,
  repairChatTexts,
  promptProse,
  replayFilesFromSnapshot,
  withChatNarration,
  withNarrative,
} from './chatRestore';
import REAL_CHAT from './fixtures/realAgentChat.json';

/*
 * A reopened Agent-mode chat. These tests are written against a REAL conversation extracted from
 * the server (the `messages` column of a chat that built a two-player game), plus hand-built cases
 * for the branches that record does not happen to contain.
 */
const messages = REAL_CHAT as unknown as Array<Record<string, any>>;

const AGENT_TURNS = [7, 9, 11, 13, 15];

const text = (value: string) => ({ type: 'text', text: value });

/* The v7 shape stored by the app: `parts` only, no `content`. */
const custom = (id: string, role: 'user' | 'assistant', parts: any[]) => ({ id, role, parts });

describe('narrativeSegments', () => {
  it('keeps what the agent said around its tool calls, in order', () => {
    const segments = narrativeSegments(messages[13]);

    expect(segments.length).toBeGreaterThan(5);
    expect(segments[0]).toContain('Je vérifie les niveaux');

    // The agent's own verdicts are the most readable line of the turn.
    expect(segments.join('\n')).toContain('Les trois niveaux passent');
  });

  it('drops the empty placeholder parts the agent emits around every step', () => {
    expect(narrativeSegments(messages[13]).every((segment) => segment.trim().length > 0)).toBe(true);
  });

  it('does not turn an install log into prose', () => {
    const message = custom('t', 'assistant', [
      {
        type: 'tool-project_run_command',
        state: 'output-available',
        input: { command: 'npm install' },
        output: { message: 'added 275 packages' },
      },
      {
        type: 'tool-project_get_process_output',
        state: 'output-available',
        input: {},
        output: { message: 'VITE v5 ready in 400 ms' },
      },
    ]);

    expect(narrativeSegments(message)).toEqual([]);
  });

  it('keeps the agent report a project tool result carries', () => {
    const message = custom('t', 'assistant', [
      {
        type: 'tool-project_patch_file',
        state: 'output-available',
        input: { path: 'src/App.tsx', newText: 'x', oldText: 'y' },
        output: { path: 'src/App.tsx', patched: true, message: 'Correction appliquée : le sol du niveau 2.' },
      },
    ]);

    expect(narrativeSegments(message)).toEqual(['Correction appliquée : le sol du niveau 2.']);
  });

  it('leaves the artifact markup out', () => {
    expect(narrativeSegments(messages[1]).join('\n')).not.toContain('<boltArtifact');
  });
});

describe('withChatNarration', () => {
  it('gives every agent turn a text body, which is what the bubble renders', () => {
    const repaired = withChatNarration(messages);

    const body = (index: number) => String(repaired[index].content ?? '');

    for (const index of AGENT_TURNS) {
      expect(body(index).length).toBeGreaterThan(40);
    }

    expect(body(13)).toContain('Les trois niveaux passent');
  });

  it('keeps the original text first, then adds nothing twice', () => {
    const once = withChatNarration(messages);

    /*
     * A chat is read from IndexedDB on every open, so the objects are new each time: the proof of
     * idempotence is the content, not the identity.
     */
    expect(withChatNarration(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it('never rewrites what the user typed', () => {
    const repaired = withChatNarration(messages);

    expect(repaired[0].content).toBe(messages[0].content);
    expect(repaired[14].content).toBe(messages[14].content);
  });

  it('is idempotent on a single message it already folded', () => {
    const once = withNarrative(messages[13]);

    expect(withNarrative(once)).toBe(once);
  });

  it('replaces, rather than appends, when told to', () => {
    expect(
      withNarrative({ role: 'assistant', content: 'old prose', parts: [text('new prose')] }, { replace: true }).content,
    ).toBe('new prose');
  });
});

describe('repairChatTexts', () => {
  /*
   * The shape the assistant bubble renders: a turn with only empty text parts and tool calls shows
   * its timeline and no prose at all. Built here so the lifecycle case does not depend on the
   * fixture's own narration, which the timeline already renders.
   */
  const toolOnlyTurn = custom('agent-turn', 'assistant', [
    { type: 'text', text: '' },
    {
      type: 'tool-project_patch_file',
      state: 'output-available',
      input: { path: 'src/game/engine.ts', oldText: 'a', newText: 'b' },
      output: { path: 'src/game/engine.ts', patched: true, message: 'Correction appliquée : le sol du niveau 2.' },
    },
    { type: 'text', text: '' },
  ]);

  it('fills a turn that would render as an empty bubble', () => {
    const repaired = repairChatTexts([
      { id: 'u', role: 'user', content: 'corrige', parts: [text('corrige')] },
      toolOnlyTurn,
    ]);

    expect(repaired[1].content).toContain('le sol du niveau 2');
  });

  it('shows the recovered summary when the turn has no narration of its own', () => {
    const silent: any = custom('silent', 'assistant', [
      {
        type: 'data-chatSummary',
        data: { summary: '- **Project**: Jeu coopératif\n- **Current Phase**: niveaux', chatId: 'silent' },
      },
      { type: 'data-progress', data: { label: 'response', status: 'in-progress', message: 'Generating' } },
    ]);

    expect(repairChatTexts([silent])[0].content).toContain('Projet');
  });

  it('leaves a chat the timeline already explains untouched, and the same array', () => {
    /* Turn 13 of the record narrates its own steps: the timeline renders them, nothing to add. */
    const narrated = [messages[12], messages[13]];

    expect(repairChatTexts(narrated)).toBe(narrated);
  });

  it('can also repair a chat whose timeline shows only steps, never the answers', () => {
    /*
     * The picture Alex reported: a timeline of "read / wrote / ran" rows and no sentence about what
     * was found. The untouched-chat cases above must keep their behaviour, so this repair is opt-in.
     */
    const repaired = repairChatTexts(messages, { repairNarrated: true });

    expect(repaired[13].content).toContain('Les trois niveaux passent');
    expect(repaired[13].content).not.toContain('<boltArtifact');
    expect(repaired[0].content).toBe(messages[0].content);
  });

  it('never touches the parts, which are what the model receives', () => {
    const repaired = repairChatTexts([toolOnlyTurn]);

    expect(repaired[0].parts).toBe(toolOnlyTurn.parts);
  });
});

describe('promptProse', () => {
  it('drops the model header a user message carries', () => {
    expect(promptProse(messages[6].content)).toBe("y'a un  bug quand je suis mort ça doit repartir vérifie pas de bug");
  });
});

describe('latestConversationContext', () => {
  it('finds the last summary, the files in context and the usage of the chat', () => {
    const context = latestConversationContext(messages);

    expect(context.summary?.summary).toContain('# Project Overview');
    expect(context.summary?.chatId).toBeTruthy();
    expect(context.files?.length).toBeGreaterThan(0);
    expect(context.usage?.totalTokens).toBeGreaterThan(0);
  });

  it('does not mistake a progress part for a summary', () => {
    const progressOnly = custom('p', 'assistant', [
      { type: 'data-progress', data: { label: 'response', status: 'in-progress', message: 'Generating' } },
    ]);

    expect(latestConversationContext([progressOnly]).summary).toBeUndefined();
  });
});

describe('missingTurnContext', () => {
  it('fills a last turn that lost its context, from the previous turns of the same chat', () => {
    const last = custom('derniere', 'assistant', [text('réponse finale')]);
    const chat = messages.slice(0, 18).concat([last]);

    const filled = missingTurnContext(chat, 'derniere');

    expect(filled.summary?.summary).toContain('# Project Overview');
    expect(filled.usage?.totalTokens).toBeGreaterThan(0);
  });

  it('returns nothing when the turn already carries its context', () => {
    expect(missingTurnContext(messages, messages[13].id)).toEqual({});
  });

  it('returns nothing when no turn of the chat ever had a summary, rather than inventing one', () => {
    const chat = [custom('u', 'user', [text('bonjour')]), custom('a', 'assistant', [text('bonjour !')])];

    expect(missingTurnContext(chat, 'a')).toEqual({});
  });
});

describe('chatSummaryText', () => {
  it('turns the structured summary into a short readable recap', () => {
    const recap = chatSummaryText(messages[13]);

    expect(recap).toBeDefined();
    expect(recap!.length).toBeLessThan(700);
    expect(recap).not.toContain('---');
    expect(recap).not.toContain('**');
    expect(recap).toContain('Platformer game');
  });
});

describe('annotateTurn', () => {
  it('appends the recovered annotations as parts', () => {
    const annotated = annotateTurn(custom('t', 'assistant', [text('hi')]), {
      summary: { summary: 'S', chatId: 't' },
      files: ['src/App.tsx'],
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    });

    expect(annotated.parts.map((part: any) => part.type)).toEqual([
      'text',
      'data-chatSummary',
      'data-codeContext',
      'data-usage',
    ]);
  });

  it('never duplicates an annotation the turn already carries', () => {
    const annotated = annotateTurn(
      custom('t', 'assistant', [{ type: 'data-chatSummary', data: { summary: 'existing' } }]),
      { summary: { summary: 'other' } },
    );

    expect(annotated.parts.filter((part: any) => part.type === 'data-chatSummary')).toHaveLength(1);
  });

  it('never invents usage it does not have', () => {
    const annotated = annotateTurn(custom('t', 'assistant', [text('hi')]), {
      usage: { totalTokens: 3 } as never,
    });

    expect(annotated.parts.some((part: any) => part.type === 'data-usage')).toBe(false);
  });
});

describe('buildAgentRestoreActions', () => {
  it('starts the project even when no tool call ever ran a command', () => {
    expect(buildAgentRestoreActions({})).toBe('<boltAction type="start">npm run dev</boltAction>');
  });

  it('writes nothing when an artifact already starts the project', () => {
    expect(buildAgentRestoreActions({ hasStart: true })).toBe('');
  });

  it("prefers the agent's own last command to a guessed one", () => {
    expect(buildAgentRestoreActions({ agentStartCommand: 'pnpm run start' })).toBe(
      '<boltAction type="start">pnpm run start</boltAction>',
    );
  });

  it('installs in the same command when the agent rewrote a manifest', () => {
    /*
     * A separate install action can be skipped and the start then runs on a stale tree; chaining
     * them is the only ordering the runner cannot get wrong.
     */
    expect(buildAgentRestoreActions({ reinstall: true })).toBe(
      '<boltAction type="start">npm install --no-audit --no-fund && npm run dev</boltAction>',
    );
  });

  it('keeps the setup command detected from a real package.json', () => {
    expect(
      buildAgentRestoreActions({
        commands: { setupCommand: 'pnpm install --no-frozen-lockfile', startCommand: 'pnpm dev' },
      }),
    ).toBe('<boltAction type="start">pnpm install --no-frozen-lockfile && pnpm dev</boltAction>');
  });
});

describe('replayFilesFromSnapshot', () => {
  it('takes the text files of the snapshot and skips binary entries', () => {
    const snapshot = {
      files: {
        '/home/project/src/App.tsx': { type: 'file', content: 'export const A = 1;', isBinary: false },
        '/home/project/public/logo.png': { type: 'file', content: 'AAAA', isBinary: true },
        '/home/project/src': { type: 'folder' },
      },
    } as never;

    expect(Object.keys(replayFilesFromSnapshot(snapshot))).toEqual(['/home/project/src/App.tsx']);
  });
});

describe('buildAgentReplayMessage', () => {
  const create = (input: { text: string; flags: string[] }) => input;

  it('carries the narration and the artifact in the same message', () => {
    const message = buildAgentReplayMessage(
      {
        id: 'restored-agent-files',
        title: 'Restored project files',
        files: { '/home/project/src/App.tsx': 'export const A = 1;' },
        commandActions: '<boltAction type="start">npm run dev</boltAction>',
        narration: "J'ai trouvé la cause du blocage.",
        flags: ['no-store'],
      },
      encodeFileActions,
      create,
      () => 'generated',
    ) as { text: string; flags: string[] };

    expect(message.text.startsWith("J'ai trouvé la cause du blocage.")).toBe(true);
    expect(message.text).toContain('<boltArtifact id="restored-agent-files"');
    expect(message.flags).toEqual(['no-store']);
  });

  it('is undefined when there is nothing to replay', () => {
    expect(
      buildAgentReplayMessage(
        { id: 'x', title: 'x', files: {}, commandActions: '' },
        encodeFileActions,
        create,
        () => 'g',
      ),
    ).toBeUndefined();
  });

  it('encodes file bodies so the parser does not clean them up', () => {
    const encoded = encodeFileActions({ '/home/project/src/App.tsx': 'const a = "<div/>";' });

    expect(encoded).toContain('encoding="base64"');
    expect(encoded).not.toContain('<div/>');
  });
});
