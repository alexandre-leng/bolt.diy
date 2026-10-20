/**
 * What a reopened chat has to show for the conversation to be back.
 *
 * A conversation built in Agent mode stores almost nothing as prose: the assistant `content` is
 * empty, and everything the model said between its tool calls lives in `text` parts that the chat
 * bubble never renders once tool invocations exist (AssistantMessage renders the timeline instead).
 * Reopening such a chat therefore showed collapsed "Read x / Wrote y" rows on the left and blank
 * messages on the right, although the whole narration was in the record all along.
 *
 * This module puts back, from the stored messages alone:
 *
 * 1. the narration, folded into the message text the timeline renders;
 * 2. the turn context (summary, files in context, token usage) when a turn reaches this device
 *    without it;
 * 3. the start command, for a project whose only "run" was an Agent tool call, which is never
 *    re-executed on reopen;
 * 4. the files the snapshot holds, for the same reason.
 *
 * Nothing is invented: a rule that cannot prove its value returns nothing.
 */
import { getMessageAnnotations, getToolName, getToolOutput, getToolState } from './messageMigration';
import type { Snapshot } from './types';
import { encodeBase64Utf8 } from '~/utils/base64Utf8';

type AnyPart = Record<string, any>;
type AnyMessage = { id?: string; role?: string; parts?: AnyPart[]; content?: unknown; annotations?: unknown };

/** Tools whose "message" is build output, never a sentence the user should read as prose. */
const OUTPUT_IS_LOG = new Set(['project_run_command', 'project_get_process_output', 'project_stop_process']);

/** Beyond this a tool "message" is a payload (a file body, a listing), not a sentence. */
const MAX_PROSE_LENGTH = 4_000;

const DEFAULT_START_COMMAND = 'npm run dev';

export interface NarrationOptions {
  /** Replace the existing text instead of appending to it. */
  replace?: boolean;
}

function stripMarkup(value: string): string {
  return value.replace(/<boltAction\b[\s\S]*?<\/boltAction>/g, '').replace(/<\/?boltArtifact\b[^>]*>/g, '');
}

/**
 * The sentence a tool result amounts to, or nothing.
 *
 * `output.message` is the agent's own report (« Les trois niveaux passent… »), the most readable
 * line of a replayable turn, and it was never displayed on reopen.
 */
function reportOf(part: AnyPart): string | undefined {
  if (getToolState(part) !== 'output-available') {
    return undefined;
  }

  const tool = getToolName(part);

  if (!tool || OUTPUT_IS_LOG.has(tool)) {
    return undefined;
  }

  const raw = getToolOutput(part);

  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const output = ((raw as Record<string, any>).structuredContent ?? raw) as Record<string, any>;

  if (!output || typeof output !== 'object' || output.isError === true) {
    return undefined;
  }

  const message = typeof output.message === 'string' ? output.message.trim() : '';

  return message && message.length <= MAX_PROSE_LENGTH ? message : undefined;
}

/**
 * The text of an assistant turn, in order, with the reports its tool calls carry.
 *
 * Empty text parts are dropped: the agent emits one placeholder per step and an empty buffer
 * renders as an empty paragraph.
 */
export function narrativeSegments(message: AnyMessage): string[] {
  if (message.role !== 'assistant') {
    return [];
  }

  const segments: string[] = [];

  for (const part of message.parts || []) {
    if (part?.type === 'text' && typeof part.text === 'string') {
      /* A bare tag stream is artifact markup, not a sentence. */
      const text = stripMarkup(part.text).trim();

      if (text) {
        segments.push(text);
      }

      continue;
    }

    if (part) {
      const report = reportOf(part);

      if (report) {
        segments.push(report);
      }
    }
  }

  return segments;
}

/**
 * The message with its narration in `content`.
 *
 * Returns the SAME object when nothing is missing, so a caller can tell by identity whether a
 * chat needs repairing at all.
 */
export function withNarrative(message: AnyMessage, options: NarrationOptions = {}): AnyMessage {
  const existing = typeof message.content === 'string' ? message.content : '';
  const folded = narrativeSegments(message).join('\n\n');

  if (!folded) {
    return message;
  }

  if (options.replace === true) {
    return existing === folded ? message : { ...message, content: folded };
  }

  /*
   * Compared on whole lines: an artifact's body contains every sentence of the block, so a plain
   * `includes` is true before the full text was folded in and the fold was silently skipped.
   */
  if (existing.trim() === folded.trim() || `\n${existing}\n`.includes(`\n${folded}\n`)) {
    return message;
  }

  const content = existing.trim() ? `${existing.trimEnd()}\n\n${folded}` : folded;

  return { ...message, content };
}

/** Folds the narration of every assistant message, returning the same array when nothing changed. */
export function withChatNarration(messages: AnyMessage[]): AnyMessage[] {
  let changed = false;

  const next = messages.map((message) => {
    const repaired = withNarrative(message);

    if (repaired !== message) {
      changed = true;
    }

    return repaired;
  });

  return changed ? next : messages;
}

/*
 * What the assistant bubble renders today for an Agent-mode turn: the timeline (text parts and tool
 * rows), or nothing at all when the turn has neither. A bubble that shows the narrative — the text
 * itself, or the summary the bubble can rebuild from the turn's annotations — is already readable.
 */
function textParts(message: AnyMessage): any[] {
  const parts = message.parts;
  const list = Array.isArray(parts) ? parts : [];

  return list.filter(
    (part) => part && part.type === 'text' && typeof part.text === 'string' && part.text.trim() !== '',
  );
}

/*
 * What the assistant bubble shows today for an Agent-mode turn: the timeline its text parts feed,
 * or nothing when the turn has neither text nor a summary it can render.
 */
function bubbleShowsSomething(message: AnyMessage): boolean {
  const rawContent = message.content as any;

  const hasContent =
    typeof rawContent === 'string' ? rawContent.trim() !== '' : rawContent !== null && rawContent !== undefined;

  /*
   * A summary is not "something to show" yet: `{ type: 'data-chatSummary' }` carries no text part,
   * and the bubble renders the summary from a prop fed by `parsedContent`. A turn whose only
   * annotation is its summary has to be repaired, so it is deliberately not counted here.
   */
  if (hasContent) {
    return true;
  }

  return textParts(message).length > 0;
}

/**
 * Text repairs for a chat that comes back from the server.
 *
 * Only the turns that would otherwise render as an empty bubble are touched, and only their
 * user-visible `content`: the stored `parts` (what the model receives) are left exactly as recorded,
 * so this cannot change a later request. The assistant's `content` was empty for every Agent-mode
 * turn of the real conversation this was measured on, which is why reopening it showed the tool
 * timeline on the left and blank bubbles on the right.
 */
export function repairChatTexts(messages: AnyMessage[], options: { repairNarrated?: boolean } = {}): AnyMessage[] {
  let changed = false;

  const repaired: AnyMessage[] = [];

  for (const message of messages) {
    if (message.role !== 'assistant') {
      repaired.push(message);
      continue;
    }

    const readable = bubbleShowsSomething(message);

    if (!readable) {
      const recap = chatSummaryText(message);

      if (recap) {
        changed = true;

        const repairedMessage: AnyMessage = Object.assign({}, message);
        repairedMessage.content = recap;
        repaired.push(repairedMessage);
        continue;
      }

      /* A turn with narration only needs its text folded in, whatever the caller asked for. */
      const folded = withNarrative(message, { replace: true });

      if (folded !== message) {
        changed = true;
        repaired.push(folded);
        continue;
      }
    }

    if (!options.repairNarrated) {
      repaired.push(message);
      continue;
    }

    const narrated = withNarrative(message, { replace: true });

    if (narrated !== message) {
      changed = true;
    }

    repaired.push(narrated);
  }

  return changed ? repaired : messages;
}

/** User prompts carry `[Model: …]\n\n[Provider: …]`; that header is not the user's text. */
export function promptProse(text: string): string {
  return text
    .replace(/^\[Model:[^\]]*\](\r?\n)*/i, '')
    .replace(/^\[Provider:[^\]]*\](\r?\n)*/i, '')
    .trim();
}

export interface TurnContext {
  summary?: { summary: string; chatId?: string };
  files?: string[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/** Context annotations a turn needs, keeping whatever it already has. */
export function annotateTurn(message: AnyMessage, context: TurnContext): AnyMessage & { parts: AnyPart[] } {
  const present = new Set(getMessageAnnotations(message).map((annotation) => annotation.type));
  const parts = [...(message.parts || [])];

  let added = false;

  if (context.summary?.summary && !present.has('chatSummary')) {
    parts.push({ type: 'data-chatSummary', data: context.summary });
    added = true;
  }

  if (context.files && context.files.length > 0 && !present.has('codeContext')) {
    parts.push({ type: 'data-codeContext', data: { files: context.files } });
    added = true;
  }

  const usage = context.usage;

  if (
    usage &&
    !present.has('usage') &&
    typeof usage.totalTokens === 'number' &&
    typeof usage.promptTokens === 'number' &&
    typeof usage.completionTokens === 'number'
  ) {
    parts.push({ type: 'data-usage', data: usage });
    added = true;
  }

  return added ? { ...message, parts } : (message as AnyMessage & { parts: AnyPart[] });
}

/**
 * The last context a chat can prove it had, taken from its most recent annotated turn.
 *
 * A chat whose final turn lost its summary/usage (a stream that dropped the annotation, a copy
 * written by an older build) can still recover both from the turn before.
 */
export function latestConversationContext(messages: AnyMessage[]): TurnContext {
  let context: TurnContext = {};

  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue;
    }

    for (const annotation of getMessageAnnotations(message)) {
      if (annotation.type === 'chatSummary' && typeof annotation.summary === 'string' && annotation.summary.trim()) {
        context = {
          ...context,
          summary: { summary: annotation.summary, chatId: annotation.chatId as string | undefined },
        };
      } else if (annotation.type === 'codeContext' && Array.isArray(annotation.files)) {
        const files = (annotation.files as unknown[]).filter((file): file is string => typeof file === 'string');

        if (files.length > 0) {
          context = { ...context, files };
        }
      } else if (annotation.type === 'usage') {
        const { promptTokens, completionTokens, totalTokens } = annotation as Record<string, unknown>;

        if (
          typeof totalTokens === 'number' &&
          typeof promptTokens === 'number' &&
          typeof completionTokens === 'number'
        ) {
          context = { ...context, usage: { promptTokens, completionTokens, totalTokens } };
        }
      }
    }
  }

  return context;
}

/** What a given turn is missing, as far as the rest of the chat can prove it. */
export function missingTurnContext(messages: AnyMessage[], turnId: string | undefined): TurnContext {
  const turn = messages.find((message) => message.id === turnId);

  if (!turn || turn.role !== 'assistant') {
    return {};
  }

  const present = new Set(getMessageAnnotations(turn).map((annotation) => annotation.type));
  const known = latestConversationContext(messages);
  const missing: TurnContext = {};

  if (known.summary && !present.has('chatSummary')) {
    missing.summary = known.summary;
  }

  if (known.files && !present.has('codeContext')) {
    missing.files = known.files;
  }

  if (known.usage && !present.has('usage')) {
    missing.usage = known.usage;
  }

  return missing;
}

/**
 * The structured summary rendered as a short recap.
 *
 * `createSummary` returns markdown sections (`# Project Overview`, `- **Project**: …`), several
 * paragraphs long. Shown raw in a chat bubble it is unreadable; the project line and the current
 * phase are what tell a returning user where the work stood.
 */
export function chatSummaryText(message: AnyMessage): string | undefined {
  const annotation = getMessageAnnotations(message)
    .filter((entry) => entry.type === 'chatSummary' && typeof entry.summary === 'string')
    .pop();

  const raw = annotation?.summary as string | undefined;

  if (!raw) {
    return undefined;
  }

  const clean = (value: string) => value.replace(/\*\*/g, '').trim();

  /* Whole line only: `# Project Overview` is a heading, not the project's name. */
  const project = raw.match(/^\s*[-*]?\s*\*{0,2}Project\*{0,2}\s*:\s*(.+)$/im)?.[1];
  const phase = raw.match(/^\s*[-*]?\s*\*{0,2}Current Phase\*{0,2}\s*:\s*(.+)$/im)?.[1];
  const lastTopic = raw.match(/^\s*[-*]?\s*\*{0,2}Last Topic\*{0,2}\s*:\s*(.+)$/im)?.[1];

  const lines = [
    project ? `Projet : ${clean(project)}` : '',
    phase ? `Phase : ${clean(phase)}` : '',
    lastTopic ? `Dernier sujet : ${clean(lastTopic)}` : '',
  ].filter(Boolean);

  if (lines.length === 0) {
    /* Unknown shape: keep the first paragraph, which is always the overview. */
    const firstBlock = raw
      .split(/\n\s*\n/)
      .map((block) => clean(block.replace(/^#.*$/gm, '')))
      .find((block) => block.length > 0);

    return firstBlock?.slice(0, 400);
  }

  return lines.join('\n');
}

const START_RE = /^(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start)\b/;
const INSTALL_RE = /^(npm|pnpm|yarn|bun)\s+(install|i|ci)\b/;

export interface ReplayCommands {
  /** Whatever the caller already knows about the project's commands. */
  commands?: { setupCommand?: string; startCommand?: string };

  /** The last dev-server command the agent actually ran. */
  agentStartCommand?: string;

  /** The agent, or the snapshot, rewrote a manifest: the template's install is stale. */
  reinstall?: boolean;

  /** An artifact already starts the project itself. */
  hasStart?: boolean;
}

/** Install command per package manager, kept in sync with `detectProjectCommands`. */
const INSTALL_COMMANDS: Record<string, string> = {
  npm: 'npm install --no-audit --no-fund',
  pnpm: 'pnpm install --no-frozen-lockfile',
  yarn: 'yarn install',
  bun: 'bun install',
};

function packageManagerOf(command: string): string {
  const name = command.trim().split(/\s+/)[0];

  return name in INSTALL_COMMANDS ? name : 'npm';
}

/**
 * The install/start actions a replay must add.
 *
 * Measured on a real Agent-built project: its snapshot held files only, because the agent started
 * the server with a tool call that is never re-executed on reopen. Every file came back and the
 * preview stayed empty for ever.
 *
 * Only what is missing is written: a command the caller already knows wins, the agent's own last
 * command wins over a default, and a setup is chained in front of the start in the SAME command so
 * the server can never be asked to start before its dependencies exist.
 */
export function buildAgentRestoreActions(replay: ReplayCommands): string {
  if (replay.hasStart) {
    return '';
  }

  const start = replay.agentStartCommand ?? replay.commands?.startCommand ?? DEFAULT_START_COMMAND;

  const setup =
    replay.commands?.setupCommand ?? (replay.reinstall ? INSTALL_COMMANDS[packageManagerOf(start)] : undefined);

  return `<boltAction type="start">${setup ? `${setup} && ` : ''}${start}</boltAction>`;
}

export interface AgentReplayInput {
  id: string;
  title: string;
  files: Record<string, string>;
  commandActions: string;
  narration?: string;
  flags?: string[];
}

/**
 * The message that replays an Agent-mode turn on reopen: its files, its commands, and the
 * narration that explains them.
 *
 * Its text used to be the artifact alone, which the parser turns into a card and an empty bubble:
 * a reopened project showed file cards and no sentence about what had been done.
 */
/** True when a command the agent ran starts the dev server. */
export function isStartCommand(command: unknown): boolean {
  return typeof command === 'string' && START_RE.test(command.trim());
}

/** True when a command the agent ran installs dependencies. */
export function isInstallCommand(command: unknown): boolean {
  return typeof command === 'string' && INSTALL_RE.test(command.trim());
}

/** The text files of a snapshot, by absolute path. Binary entries are written by restoreSnapshot. */
export function replayFilesFromSnapshot(snapshot: Snapshot | undefined): Record<string, string> {
  const files: Record<string, string> = {};

  for (const [path, value] of Object.entries(snapshot?.files || {})) {
    if (value?.type === 'file' && !value.isBinary) {
      files[path] = value.content;
    }
  }

  return files;
}

/**
 * `<boltAction type="file">` actions whose body the parser takes byte for byte.
 *
 * Bolt writes these itself; `encoding="base64"` makes the parser decode them instead of running its
 * model-output cleanups over source code (`&lt;` turned into `<`, fences stripped), which silently
 * corrupted restored files.
 */
export function encodeFileActions(files: Record<string, string>): string {
  return Object.entries(files)
    .map(
      ([path, content]) =>
        `<boltAction type="file" filePath="${path.replace(/"/g, '&quot;')}" encoding="base64">${encodeBase64Utf8(content)}</boltAction>`,
    )
    .join('\n');
}

/**
 * The message that replays an Agent-mode turn on reopen: its files, its commands, and the narration
 * that explains them.
 *
 * Its text used to be the artifact alone, which the parser turns into a card and an empty bubble: a
 * reopened project showed file cards and no sentence about what had been done.
 */
export function buildAgentReplayMessage(
  input: AgentReplayInput,
  stringifyFiles: (files: Record<string, string>) => string,
  create: (message: { id: string; role: 'assistant'; text: string; flags: string[] }) => unknown,
  generateId: () => string,
): unknown | undefined {
  const hasFiles = Object.keys(input.files).length > 0;

  if (!hasFiles && !input.commandActions) {
    return undefined;
  }

  const artifact = `<boltArtifact id="${input.id}" title="${input.title}" type="bundled">
${hasFiles ? stringifyFiles(input.files) : ''}
${input.commandActions}
</boltArtifact>`.trim();

  const narration = input.narration?.trim();
  const text = narration ? `${narration}\n\n${artifact}` : artifact;

  return create({ id: generateId(), role: 'assistant', text, flags: input.flags ?? [] });
}
