import { describe, expect, it } from 'vitest';
import { getProjectToolPrompt, runtimeEnvironmentLine } from './project-tools';

describe('runtime environment in the agent prompt', () => {
  it('describes the server sandbox: real shell, npm only, no process killing, no WebContainer', () => {
    const line = runtimeEnvironmentLine();

    expect(line).toContain('Linux container');
    expect(line).toContain('grep');
    expect(line).toContain('no Internet access except the npm registry');
    expect(line).toContain('project_stop_process');
    expect(line).not.toContain('WebContainer');
  });

  it('is what the project-tools prompt tells the model', () => {
    const prompt = getProjectToolPrompt({ cwd: '/home/project', allowedHtmlElements: [], modificationTagName: 'x' });

    expect(prompt).toContain(runtimeEnvironmentLine());
  });
});
