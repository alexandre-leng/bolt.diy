import { map } from 'nanostores';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionCallbackData } from '~/lib/runtime/message-parser';
import type { ArtifactState, WorkbenchStore } from '~/lib/stores/workbench';

let workbenchStoreClass: typeof import('~/lib/stores/workbench').WorkbenchStore;
let store: WorkbenchStore;

function createArtifact(actionId: string, action: unknown) {
  const runner = {
    actions: map({ [actionId]: action }),
    runAction: vi.fn().mockResolvedValue(undefined),
    addAction: vi.fn().mockResolvedValue(undefined),
  };

  return { runner } as unknown as ArtifactState;
}

beforeAll(async () => {
  // Node exposes a global BroadcastChannel; the preview store opens real ones on construction.
  vi.stubGlobal('BroadcastChannel', undefined);
  ({ WorkbenchStore: workbenchStoreClass } = await import('~/lib/stores/workbench'));
});

beforeEach(() => {
  store = new workbenchStoreClass();
});

describe('WorkbenchStore._runAction', () => {
  it('should skip a file action that has no filePath instead of throwing', async () => {
    const artifactId = 'artifact-pathless';
    const actionId = 'action-pathless';

    store.artifacts.setKey(artifactId, createArtifact(actionId, { type: 'file', content: 'const a = 1;' }));

    const data = {
      artifactId,
      messageId: 'message-1',
      actionId,
      action: { type: 'file', content: 'const a = 1;' },
    } as unknown as ActionCallbackData;

    await expect(store._runAction(data)).resolves.toBeUndefined();

    const artifact = store.artifacts.get()[artifactId];
    expect(artifact.runner.runAction).not.toHaveBeenCalled();
  });

  it('should report a pathless file action only once across repeated streaming samples', async () => {
    const artifactId = 'artifact-sampled';
    const actionId = 'action-sampled';

    // The runner hands back the same action object on every streaming sample.
    const action = { type: 'file', content: 'const a = 1;' };
    store.artifacts.setKey(artifactId, createArtifact(actionId, action));

    const data = { artifactId, messageId: 'message-1', actionId, action } as unknown as ActionCallbackData;

    const warnings: string[] = [];

    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });

    try {
      for (let i = 0; i < 25; i++) {
        await store._runAction(data, true);
      }
    } finally {
      log.mockRestore();
    }

    expect(warnings.filter((entry) => entry.includes('File action has no filePath'))).toHaveLength(1);
  });
});

describe('WorkbenchStore.addToExecutionQueue', () => {
  it('should keep processing later callbacks after one of them rejects', async () => {
    const executed: string[] = [];

    store.addToExecutionQueue(async () => {
      executed.push('first');
      throw new Error('boom');
    });

    store.addToExecutionQueue(async () => {
      executed.push('second');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(executed).toEqual(['first', 'second']);
  });
});

describe('WorkbenchStore.waitForExecutionQueue', () => {
  it('waits for a project mutation enqueued while it was already waiting', async () => {
    const order: string[] = [];

    let releaseFirst!: () => void;
    let releaseSecond!: () => void;

    void store.queueProjectMutation(async () => {
      await new Promise<void>((resolve) => (releaseFirst = resolve));
      order.push('first');
    });

    const waited = store.waitForExecutionQueue().then(() => order.push('waited'));

    // An agent write lands while the snapshot is waiting on the queue.
    void store.queueProjectMutation(async () => {
      await new Promise<void>((resolve) => (releaseSecond = resolve));
      order.push('second');
    });

    await Promise.resolve();
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseSecond();
    await waited;

    // Before the fix `waited` resolved right after `first`, ahead of the second write.
    expect(order).toEqual(['first', 'second', 'waited']);
  });
});

describe('WorkbenchStore.selectWorkbenchView', () => {
  it('should update currentView and record userSelectedView when userInitiated is true', () => {
    expect(store.currentView.get()).toBe('code');
    expect(store.userSelectedView.get()).toBeUndefined();

    store.selectWorkbenchView('diff', { userInitiated: true });
    expect(store.currentView.get()).toBe('diff');
    expect(store.userSelectedView.get()).toBe('diff');

    // Programmatic switch without userInitiated should change currentView but preserve userSelectedView
    store.selectWorkbenchView('preview');
    expect(store.currentView.get()).toBe('preview');
    expect(store.userSelectedView.get()).toBe('diff');
  });

  it('should reset userSelectedView when resetWorkbench() is called', async () => {
    store.selectWorkbenchView('diff', { userInitiated: true });
    expect(store.userSelectedView.get()).toBe('diff');

    store.showWorkbench.set(false);
    await store.resetWorkbench();
    expect(store.userSelectedView.get()).toBeUndefined();
    expect(store.currentView.get()).toBe('code');
    expect(store.showWorkbench.get()).toBe(true);
  });
});

describe('WorkbenchStore.showPreviewAfterRestore', () => {
  /*
   * Reopening a saved project must land on the Preview tab. `resetWorkbench`
   * leaves every reopen on Code, and the workbench's auto-switch only fires on a
   * `hasPreview false -> true` transition that a restore never produces (the
   * snapshot is restored during the same commit), so without this the user sees
   * the source of a project whose dev server is running behind it.
   */
  it('shows the workbench on the preview tab', () => {
    store.showWorkbench.set(false);
    store.currentView.set('code');

    store.showPreviewAfterRestore();

    expect(store.currentView.get()).toBe('preview');
    expect(store.showWorkbench.get()).toBe(true);
  });

  it('bumps the restore token so the workbench can tell a reopen from a generation', () => {
    const before = store.previewRestoreToken.get();

    store.showPreviewAfterRestore();

    expect(store.previewRestoreToken.get()).toBe(before + 1);
  });

  it('does not mark the choice as user-initiated, so a later click wins', () => {
    store.selectWorkbenchView('code', { userInitiated: true });
    store.showPreviewAfterRestore();

    expect(store.userSelectedView.get()).toBe('code');
  });
});

describe('WorkbenchStore visibility', () => {
  it('opens the workbench by default', () => {
    expect(store.showWorkbench.get()).toBe(true);
  });
});

describe('WorkbenchStore.abortAllActions', () => {
  it('should call abortAllActions on all artifact runners and reset action alert', () => {
    const mockAbortAll = vi.fn();
    store.artifacts.setKey('artifact-1', {
      runner: { abortAllActions: mockAbortAll },
    } as unknown as ArtifactState);

    store.actionAlert.set({
      type: 'preview',
      title: 'Alert',
      description: 'Test alert',
      content: 'Test content',
    });

    store.abortAllActions();

    expect(mockAbortAll).toHaveBeenCalledTimes(1);
    expect(store.actionAlert.get()).toBeUndefined();
  });
});
