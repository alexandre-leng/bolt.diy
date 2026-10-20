/**
 * Synthetic artifacts Bolt emits itself when a chat is reopened.
 *
 * They are never the user's project, and three behaviours must treat them alike:
 * the site's name must not be taken from them, publishing must wait while one is open
 * (the workbench is still replaying files), and their own card must say "Restored".
 * Two of those keyed on `restored-project-setup` alone, so a second synthetic artifact was
 * named after the restore, bypassed the restore guard, and was labelled "Project Created".
 */
export const PROJECT_SETUP_ARTIFACT_ID = 'restored-project-setup';

/** Written by the restore when the agent's tool calls need replaying (agentFileReplay.ts). */
export const AGENT_REPLAY_ARTIFACT_ID = 'restored-agent-files';

export const RESTORE_ARTIFACT_IDS = [PROJECT_SETUP_ARTIFACT_ID, AGENT_REPLAY_ARTIFACT_ID] as const;

export function isRestoreArtifact(id: string | undefined | null): boolean {
  return !!id && (RESTORE_ARTIFACT_IDS as readonly string[]).includes(id);
}

export interface ReplayMessageInput {
  id: string;
  role: 'assistant';
  text: string;
  flags: string[];
}

/**
 * The never-stored assistant message that replays a project's files and commands on reopen.
 *
 * `files` carries agent tool-writes only. A chat restored from a SNAPSHOT has none — the
 * snapshot already replayed its files through the file store — so keying the early return on
 * `files` alone collapsed this to `undefined` for exactly the chats that need it most, and the
 * project's start command was never emitted: the terminal sat at a bare `~/project` prompt and
 * the preview never came up. Measured on this deployment, a real project snapshot held 15 file
 * actions and ZERO `start`/`shell` actions, so this string was the only way to start the server.
 *
 * `stringify` and `create` are injected so this stays free of the persistence layer's imports
 * (and testable without a DOM/database).
 */
export function buildAgentReplayMessage(
  files: Record<string, string>,
  commandActions: string,
  stringifyFiles: (files: Record<string, string>) => string,
  create: (input: ReplayMessageInput) => unknown,
  generateId: () => string,
): unknown | undefined {
  const hasFiles = Object.keys(files).length > 0;

  if (!hasFiles && !commandActions) {
    return undefined;
  }

  const fileActions = hasFiles ? stringifyFiles(files) : '';

  return create({
    id: generateId(),
    role: 'assistant',

    /*
     * `hidden`: the parser keeps these actions (they write the files and start the server) and
     * emits no card. The card sat above the conversation on every reopen, labelled "Project Setup
     * Incomplete" for a setup nobody had started.
     */
    text: `<boltArtifact id="${AGENT_REPLAY_ARTIFACT_ID}" title="Restored project files" type="bundled" hidden>
${fileActions}
${commandActions}
</boltArtifact>`,
    flags: ['no-store'],
  });
}
