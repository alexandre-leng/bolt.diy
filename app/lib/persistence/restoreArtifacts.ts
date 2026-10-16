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
