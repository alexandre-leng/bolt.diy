import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * File tree width on a phone (audit U14): 20% of 390px left ~78px for the tree.
 * The resizable panels are stubbed to expose the sizes EditorPanel asks for.
 */
vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div data-panel-group>{children}</div>,
  Panel: ({
    children,
    defaultSize,
    minSize,
  }: {
    children: React.ReactNode;
    defaultSize?: number;
    minSize?: number;
  }) => (
    <div data-panel data-default-size={defaultSize} data-min-size={minSize}>
      {children}
    </div>
  ),
  Separator: () => <div />,
}));
vi.mock('./FileTree', () => ({ FileTree: () => null }));
vi.mock('./FileBreadcrumb', () => ({ FileBreadcrumb: () => null }));
vi.mock('./Search', () => ({ Search: () => null }));
vi.mock('./LockManager', () => ({ LockManager: () => null }));
vi.mock('~/components/editor/codemirror/CodeMirrorEditor', () => ({ CodeMirrorEditor: () => null }));

import { EditorPanel } from './EditorPanel';

const originalWidth = window.innerWidth;

function treePanelSize(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });

  const { container } = render(<EditorPanel />);
  const tree = container.querySelector('[data-panel]') as HTMLElement;

  return { defaultSize: Number(tree.dataset.defaultSize), minSize: Number(tree.dataset.minSize) };
}

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
});

describe('EditorPanel file tree width', () => {
  it('gives the tree at least ~160px on a 390px phone', () => {
    const { defaultSize, minSize } = treePanelSize(390);

    expect((390 * defaultSize) / 100).toBeGreaterThanOrEqual(160);
    expect((390 * minSize) / 100).toBeGreaterThanOrEqual(110);
  });

  it('keeps the compact 20% tree on a desktop', () => {
    expect(treePanelSize(1440).defaultSize).toBe(20);
  });
});
