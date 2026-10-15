import { describe, expect, it } from 'vitest';
import {
  createCommandActionsString,
  detectProjectCommands,
  parseCdTarget,
  parseStartCommand,
  withDependencyInstall,
} from './projectCommands';

/*
 * Regression tests for `jsh: command not found: vite` after a chat is restored
 * from a snapshot. Snapshot paths are absolute, so the restore emits
 * `cd "/home/project" && npm install ...` and `cd "/home/project" && npm run dev`.
 */
describe('restore commands', () => {
  it('builds cd-prefixed setup and start commands from absolute snapshot paths', async () => {
    const commands = await detectProjectCommands([
      { path: '/home/project/package.json', content: JSON.stringify({ scripts: { dev: 'vite' } }) },
      { path: '/home/project/package-lock.json', content: '{}' },
    ]);

    expect(commands.setupCommand).toBe('cd "/home/project" && npm install --no-audit --no-fund');
    expect(commands.startCommand).toBe('cd "/home/project" && npm run dev');
    expect(createCommandActionsString(commands)).toContain('<boltAction type="start">');
  });
});

describe('parseCdTarget', () => {
  it('returns only the directory, never the rest of the line', () => {
    // The old greedy /^cd\s+(.+)$/ returned the whole `"/home/project" && npm install ...`.
    expect(parseCdTarget('cd "/home/project" && npm install --no-audit --no-fund')).toBe('/home/project');
  });

  it('handles single quotes, bare paths and separators', () => {
    expect(parseCdTarget("cd '/a b' && ls")).toBe('/a b');
    expect(parseCdTarget('cd src; ls')).toBe('src');
    expect(parseCdTarget('cd app')).toBe('app');
    expect(parseCdTarget('ls -la')).toBeUndefined();
  });
});

describe('parseStartCommand / withDependencyInstall', () => {
  it('chains the install behind the cd and before the script', () => {
    const parsed = parseStartCommand('cd "/home/project" && npm run dev');

    expect(parsed).toMatchObject({ directory: '/home/project', packageManager: 'npm', rest: 'npm run dev' });
    expect(withDependencyInstall(parsed!)).toBe(
      'cd "/home/project" && npm install --no-audit --no-fund && npm run dev',
    );
  });

  it('uses the matching package manager', () => {
    expect(withDependencyInstall(parseStartCommand('pnpm run dev')!)).toBe(
      'pnpm install --no-frozen-lockfile && pnpm run dev',
    );
    expect(withDependencyInstall(parseStartCommand('yarn dev')!)).toBe('yarn install --non-interactive && yarn dev');
    expect(parseStartCommand('npm start')).toMatchObject({ directory: '.', packageManager: 'npm' });
  });

  it('leaves non package-script commands alone', () => {
    expect(parseStartCommand('npx --yes serve')).toBeUndefined();
    expect(parseStartCommand('node server.js')).toBeUndefined();
    expect(parseStartCommand('cd "/home/project" && npx --yes serve')).toBeUndefined();
  });
});
