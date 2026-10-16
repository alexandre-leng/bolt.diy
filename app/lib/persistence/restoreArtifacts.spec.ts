import { describe, expect, it } from 'vitest';
import { buildAgentReplayMessage, isRestoreArtifact, RESTORE_ARTIFACT_IDS } from './restoreArtifacts';

describe('isRestoreArtifact', () => {
  it('recognises every synthetic restore artifact, the setup one and the agent replay one', () => {
    for (const id of ['restored-project-setup', 'restored-agent-files']) {
      expect(RESTORE_ARTIFACT_IDS).toContain(id as never);
      expect(isRestoreArtifact(id)).toBe(true);
    }
  });

  it('leaves the user’s own artifacts alone', () => {
    expect(isRestoreArtifact('1792161109327')).toBe(false);
    expect(isRestoreArtifact('imported-files')).toBe(false);
    expect(isRestoreArtifact(undefined)).toBe(false);
    expect(isRestoreArtifact(null)).toBe(false);
  });
});

describe('buildAgentReplayMessage', () => {
  const stringify = (files: Record<string, string>) =>
    Object.entries(files)
      .map(([path, content]) => `<boltAction type="file" filePath="${path}">${content}</boltAction>`)
      .join('\n');

  const create = (input: { text: string }) => input;

  const make = (files: Record<string, string>, commands: string) =>
    buildAgentReplayMessage(files, commands, stringify, create, () => 'test-id') as { text: string } | undefined;

  /*
   * A chat restored from a SNAPSHOT has no agent tool-writes — the snapshot already replayed
   * its files through the file store. Keying the early return on `files` alone dropped this
   * message for exactly the chats that needed it, so no `start` action was ever emitted and
   * the terminal sat at a bare `~/project` prompt with no preview.
   */
  it('emits the start command even with no agent tool-writes', () => {
    const message = make({}, '<boltAction type="start">npm run dev</boltAction>');

    expect(message).toBeDefined();
    expect(message?.text).toContain('npm run dev');
    expect(message?.text).toContain('type="start"');
  });

  it('still emits agent tool-writes when there is no command', () => {
    const message = make({ '/src/App.tsx': 'console.log(1)' }, '');

    expect(message).toBeDefined();
    expect(message?.text).toContain('src/App.tsx');
  });

  it('returns undefined only when there is nothing at all to replay', () => {
    expect(make({}, '')).toBeUndefined();
  });

  it('does not emit an empty file-action block', () => {
    const message = make({}, '<boltAction type="start">npm run dev</boltAction>');

    expect(message?.text).not.toMatch(/type="file"/);
  });
});
