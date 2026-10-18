import { describe, expect, it } from 'vitest';
import { getProjectToolNames, refusedCommandReason } from './projectMcp.shared';

describe('getProjectToolNames', () => {
  it('includes both built-in web tools when web search is enabled', () => {
    const tools = getProjectToolNames(true);

    expect(tools).toContain('web_search');
    expect(tools).toContain('web_fetch');
  });

  it('omits both built-in web tools when web search is disabled', () => {
    const tools = getProjectToolNames(false);

    expect(tools).not.toContain('web_search');
    expect(tools).not.toContain('web_fetch');
    expect(tools).toContain('project_read_file');
  });
});

/*
 * Pagia project: the model looped `kill -9` over PIDs 14..40, killed the runtime's own processes
 * and the preview never came back in that tab. Process killing goes through project_stop_process.
 */
describe('refusedCommandReason', () => {
  it.each([
    'kill -9 23',
    'for p in 1 2 3; do kill -9 $p; done',
    'pkill -f vite',
    'killall node',
    'fuser -k 5173/tcp',
    "ps aux | grep vite | awk '{print $2}' | xargs kill",
    'node -e "process.kill(17, \'SIGKILL\')"',
    "node -e \"const cp=require('child_process');for(let p=14;p<=40;p++){cp.execSync('kill -9 '+p)}\"",
    'npm run dev; kill %1',
  ])('refuses %s', (command) => {
    expect(refusedCommandReason(command)).toContain('project_stop_process');
  });

  it.each([
    'npm run dev',
    'npm install',
    'ls src | grep -c tsx',
    'node scripts/skill.js',
    'cat src/killSwitch.ts',
    'echo skill',
  ])('allows %s', (command) => {
    expect(refusedCommandReason(command)).toBeNull();
  });
});
