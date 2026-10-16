import { describe, expect, it } from 'vitest';
import { isRestoreArtifact, RESTORE_ARTIFACT_IDS } from './restoreArtifacts';

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
