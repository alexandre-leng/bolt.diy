import { describe, expect, it, vi } from 'vitest';
import { ActionRunner } from './action-runner';
import type { WebContainer } from '~/lib/runtime/container';
import type { BoltShell } from '~/utils/shell';

describe('ActionRunner file actions', () => {
  it('marks a file action failed when creating its directory fails', async () => {
    const webcontainer = {
      workdir: '/project',
      fs: {
        mkdir: vi.fn().mockRejectedValue(new Error('filesystem unavailable')),
        writeFile: vi.fn(),
      },
    } as unknown as WebContainer;

    const runner = new ActionRunner(Promise.resolve(webcontainer), () => ({}) as BoltShell);

    const action = {
      artifactId: 'artifact-1',
      messageId: 'message-1',
      actionId: 'action-1',
      action: { type: 'file' as const, filePath: 'src/App.tsx', content: 'export default function App() {}' },
    };

    runner.addAction(action);
    await runner.runAction(action);

    expect(runner.actions.get()['action-1']).toMatchObject({ status: 'failed', error: 'Action failed' });
    expect(webcontainer.fs.writeFile).not.toHaveBeenCalled();
  });

  it('marks a file action failed when writing the file fails', async () => {
    const webcontainer = {
      workdir: '/project',
      fs: {
        mkdir: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockRejectedValue(new Error('disk full')),
      },
    } as unknown as WebContainer;

    const runner = new ActionRunner(Promise.resolve(webcontainer), () => ({}) as BoltShell);

    const action = {
      artifactId: 'artifact-1',
      messageId: 'message-1',
      actionId: 'action-2',
      action: { type: 'file' as const, filePath: 'src/App.tsx', content: 'export default function App() {}' },
    };

    runner.addAction(action);
    await runner.runAction(action);

    expect(runner.actions.get()['action-2']).toMatchObject({ status: 'failed', error: 'Action failed' });
    expect(webcontainer.fs.writeFile).toHaveBeenCalledWith('src/App.tsx', 'export default function App() {}');
  });

  /*
   * Firefox/AdGuard blank preview: the starter's exclude makes Vite serve icons/fingerprint.js on
   * its own, which tracking filters block. The container must get a config without it.
   */
  it('writes vite.config.ts without the lucide-react exclude', async () => {
    const webcontainer = {
      workdir: '/project',
      fs: { mkdir: vi.fn().mockResolvedValue(undefined), writeFile: vi.fn().mockResolvedValue(undefined) },
    } as unknown as WebContainer;

    const runner = new ActionRunner(Promise.resolve(webcontainer), () => ({}) as BoltShell);
    const content = `export default defineConfig({\n  plugins: [react()],\n  optimizeDeps: {\n    exclude: ['lucide-react'],\n  },\n});\n`;

    const action = {
      artifactId: 'artifact-1',
      messageId: 'message-1',
      actionId: 'action-3',
      action: { type: 'file' as const, filePath: 'vite.config.ts', content },
    };

    runner.addAction(action);
    await runner.runAction(action);

    const written = vi.mocked(webcontainer.fs.writeFile).mock.calls[0][1] as string;
    expect(written).not.toContain('lucide-react');
    expect(written).toContain('plugins: [react()]');
  });
});

describe('ActionRunner cancellation', () => {
  it('does not start an outgoing server after cancellation while its shell was initializing', async () => {
    vi.useFakeTimers();

    try {
      let ready!: () => void;

      const shellReady = new Promise<void>((resolve) => {
        ready = resolve;
      });

      const executeCommand = vi.fn();

      const runner = new ActionRunner(
        Promise.resolve({} as WebContainer),
        () => ({ ready: () => shellReady, executeCommand, terminal: {}, process: {} }) as unknown as BoltShell,
      );
      const action = {
        artifactId: 'old-project',
        messageId: 'old-message',
        actionId: 'old-server',
        action: { type: 'start' as const, content: 'npm run dev' },
      };

      runner.addAction(action);

      const running = runner.runAction(action);
      await Promise.resolve();
      runner.abortAllActions();
      ready();
      await vi.advanceTimersByTimeAsync(2000);
      await running;

      expect(executeCommand).not.toHaveBeenCalled();
      expect(runner.actions.get()['old-server'].status).toBe('aborted');
    } finally {
      vi.useRealTimers();
    }
  });
});
