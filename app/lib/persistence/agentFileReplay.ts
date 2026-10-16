/**
 * Rebuilds the files an Agent-mode conversation produced, from its messages alone.
 *
 * In Agent mode the model edits the project through tool calls (`project_write_file`,
 * `project_patch_file`, `project_delete_path`) instead of `<boltArtifact>` actions. Those
 * tool parts are never re-executed when a chat is reopened: only artifacts are. The project
 * files therefore came back only through the IndexedDB snapshot, which is per browser and is
 * never synced to the server. Reopening the chat on another device (or with a snapshot older
 * than the last agent turn) restored the starter template instead of the generated project,
 * while "Publier" — which reads the live file tree of the tab that built it — still showed
 * the right site.
 *
 * This module folds every file operation recorded in the messages, in order, so the final
 * content of each agent-touched file can be written back on restore. A patch whose base is
 * not known exactly is never guessed: that path is left alone rather than overwritten with a
 * wrong version.
 */
import { decodeBase64Utf8, encodeBase64Utf8 } from '~/utils/base64Utf8';
import { WORK_DIR } from '~/utils/constants';

type AnyPart = Record<string, any>;
type AnyMessage = { id?: string; role?: string; parts?: AnyPart[]; content?: unknown };

export interface AgentReplayResult {
  /** Final content of every file an agent tool call touched in the replayed range. */
  files: Record<string, string>;

  /** Final known state of the whole project (artifact files + agent writes). */
  state: Record<string, string>;

  /** Agent-touched paths whose final content could not be determined exactly. */
  unresolved: string[];

  /** True when the replayed range contains any successful agent file operation. */
  hasAgentWrites: boolean;
}

const FILE_ACTION_RE = /<boltAction\b([^>]*)>([\s\S]*?)<\/boltAction>/g;

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? match[1] : undefined;
}

export function toAbsoluteProjectPath(path: string): string {
  if (path.startsWith(`${WORK_DIR}/`) || path === WORK_DIR) {
    return path;
  }

  return `${WORK_DIR}/${path.replace(/^\.?\/+/, '')}`;
}

function textOf(message: AnyMessage): string {
  if (typeof message.content === 'string' && !message.parts?.length) {
    return message.content;
  }

  return (message.parts || [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
}

function toolNameOf(part: AnyPart): string | undefined {
  if (part?.type === 'dynamic-tool') {
    return typeof part.toolName === 'string' ? part.toolName : undefined;
  }

  if (typeof part?.type === 'string' && part.type.startsWith('tool-')) {
    return part.type.slice('tool-'.length);
  }

  return undefined;
}

/** A tool output that reports success, in either the plain or the MCP envelope shape. */
function successfulOutput(part: AnyPart): Record<string, any> | undefined {
  if (part.state !== 'output-available') {
    return undefined;
  }

  let output = part.output;

  if (
    output &&
    typeof output === 'object' &&
    output.structuredContent &&
    typeof output.structuredContent === 'object'
  ) {
    if (output.isError) {
      return undefined;
    }

    output = output.structuredContent;
  }

  if (!output || typeof output !== 'object' || output.isError || output.error) {
    return undefined;
  }

  return output as Record<string, any>;
}

/**
 * Folds all file operations of `messages` on top of `base`.
 *
 * Only operations from messages at index >= `replayFrom` are reported in `files`; earlier
 * ones only build the base state (e.g. what the snapshot already restored).
 */
export function replayAgentFileOps(
  messages: AnyMessage[],
  options: { base?: Record<string, string>; replayFrom?: number } = {},
): AgentReplayResult {
  const state = new Map<string, string>(Object.entries(options.base || {}));
  const unknown = new Set<string>();
  const touched = new Set<string>();
  const replayFrom = options.replayFrom ?? 0;

  let hasAgentWrites = false;

  /*
   * When a base snapshot is supplied it already reflects every message before
   * `replayFrom`, so those are skipped instead of being folded a second time.
   */
  const startAt = options.base ? replayFrom : 0;

  messages.forEach((message, index) => {
    if (index < startAt || message?.role !== 'assistant') {
      return;
    }

    const inRange = index >= replayFrom;

    for (const part of message.parts || []) {
      if (part?.type === 'text' && typeof part.text === 'string') {
        for (const match of part.text.matchAll(FILE_ACTION_RE)) {
          const tag = match[1];

          if (attr(tag, 'type') !== 'file') {
            continue;
          }

          const filePath = attr(tag, 'filePath');

          if (!filePath) {
            continue;
          }

          const absolute = toAbsoluteProjectPath(filePath);
          const raw = match[2];
          const content = attr(tag, 'encoding') === 'base64' ? decodeBase64Utf8(raw.trim()) : `${raw.trim()}\n`;
          state.set(absolute, content);
          unknown.delete(absolute);

          /*
           * Artifact actions are re-executed by the parser on restore; they are only
           * tracked so a later patch has the right base.
           */
        }

        continue;
      }

      const toolName = toolNameOf(part);

      if (!toolName) {
        continue;
      }

      const output = successfulOutput(part);
      const input = (part.input || {}) as Record<string, any>;

      if (!output) {
        continue;
      }

      const rawPath = typeof output.path === 'string' ? output.path : input.path;

      if (typeof rawPath !== 'string' || !rawPath) {
        continue;
      }

      const absolute = toAbsoluteProjectPath(rawPath);

      if (toolName === 'project_write_file') {
        if (typeof input.content !== 'string' || output.written === false) {
          continue;
        }

        state.set(absolute, input.content);
        unknown.delete(absolute);
      } else if (toolName === 'project_patch_file') {
        if (output.patched !== true || output.changed === false) {
          continue;
        }

        const current = state.get(absolute);
        const oldText = input.oldText;
        const newText = input.newText;

        if (
          unknown.has(absolute) ||
          current === undefined ||
          typeof oldText !== 'string' ||
          typeof newText !== 'string' ||
          !oldText
        ) {
          unknown.add(absolute);
        } else {
          const first = current.indexOf(oldText);

          if (first < 0 || current.indexOf(oldText, first + oldText.length) >= 0) {
            unknown.add(absolute);
          } else {
            state.set(absolute, current.slice(0, first) + newText + current.slice(first + oldText.length));
          }
        }
      } else if (toolName === 'project_delete_path') {
        if (output.deleted !== true) {
          continue;
        }

        for (const key of [...state.keys()]) {
          if (key === absolute || key.startsWith(`${absolute}/`)) {
            state.delete(key);
            unknown.delete(key);
            touched.delete(key);
          }
        }

        continue;
      } else {
        continue;
      }

      if (inRange) {
        touched.add(absolute);
        hasAgentWrites = true;
      }
    }
  });

  const files: Record<string, string> = {};
  const unresolved: string[] = [];

  for (const path of touched) {
    if (unknown.has(path) || !state.has(path)) {
      unresolved.push(path);
      continue;
    }

    files[path] = state.get(path)!;
  }

  return { files, state: Object.fromEntries(state), unresolved, hasAgentWrites };
}

/** `<boltAction type="file">` actions whose content survives the parser byte for byte. */
export function createEncodedFileActions(files: Record<string, string>): string {
  return Object.entries(files)
    .map(
      ([filePath, content]) =>
        `<boltAction type="file" filePath="${filePath.replace(/"/g, '&quot;')}" encoding="base64">${encodeBase64Utf8(content)}</boltAction>`,
    )
    .join('\n');
}

/** True when an assistant message in `messages` already starts the project itself. */
export function messagesContainStartAction(messages: AnyMessage[]): boolean {
  return messages.some(
    (message) => message?.role === 'assistant' && /<boltAction\b[^>]*type="start"/.test(textOf(message)),
  );
}
