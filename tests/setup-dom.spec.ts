import { describe, expect, it } from 'vitest';
import { DOM_PROJECT, NODE_PROJECT, SHARED_EXCLUDE } from '../vitest.config';

/**
 * Guards the project split.
 *
 * A `**` pattern in the `dom` project's `include` that matches nothing fails
 * open: the file list silently shrinks and the suite still reports green. That
 * is not hypothetical — an earlier version of this config used
 * `tests/unit/**` style globs and quietly dropped 11 files and 116 tests while
 * still printing "All tests passed". These assertions make the inventory
 * explicit so the next edit cannot lose coverage without something failing.
 */

/**
 * Excluded by both projects, matching the previous behaviour exactly.
 *
 * `Markdown.spec.ts` is the only one left here: it imports `import.meta.hot` in a way
 * neither project can satisfy. `workbench.spec.ts` was excluded alongside it, but that
 * hid 10 real tests — the timeout it hit came from `filesStore.reset()` awaiting a
 * WebContainer that never boots in tests, not from the project split. That await is now
 * time-boxed, so the spec runs in the `dom` project where it belongs and its coverage is
 * asserted below instead of being silently dropped.
 */
const LONG_EXCLUDED = ['app/components/chat/Markdown.spec.ts'];

describe('vitest project split', () => {
  it('defines a node and a dom project', () => {
    expect(NODE_PROJECT.name).toBe('node');
    expect(NODE_PROJECT.environment).toBe('node');
    expect(DOM_PROJECT.name).toBe('dom');
    expect(DOM_PROJECT.environment).toBe('jsdom');
  });

  it('uses only concrete paths in the dom project include', () => {
    /*
     * The exact defect this guards against: a glob that resolves to no files
     * reports success. A non-empty, glob-free list is the cheap precondition.
     */
    expect(DOM_PROJECT.include.length).toBeGreaterThan(0);
    expect(DOM_PROJECT.include.filter((pattern: string) => pattern.includes('*'))).toEqual([]);
  });

  it('still runs the workbench store spec instead of excluding its 10 tests', () => {
    /*
     * Regression guard: this file was once excluded from both projects, which removed
     * its tests from the run without any failure being reported.
     */
    expect(DOM_PROJECT.include).toContain('app/lib/stores/workbench.spec.ts');
    expect(NODE_PROJECT.exclude).toContain('app/lib/stores/workbench.spec.ts');
    expect(DOM_PROJECT.exclude).not.toContain('app/lib/stores/workbench.spec.ts');
  });

  it('subtracts every dom test from the node project', () => {
    for (const pattern of DOM_PROJECT.include) {
      expect(NODE_PROJECT.exclude, `${pattern} must be excluded from node`).toContain(pattern);
    }
  });

  it('keeps both projects in agreement about the shared excludes', () => {
    for (const pattern of LONG_EXCLUDED) {
      expect(NODE_PROJECT.exclude).toContain(pattern);
      expect(DOM_PROJECT.exclude).toContain(pattern);
    }

    expect(SHARED_EXCLUDE).toContain('**/tests/e2e/**');
    expect(SHARED_EXCLUDE).toContain('**/tests/preview/**');
  });

  it('loads the DOM-free base setup in node and both layers in dom', () => {
    expect(NODE_PROJECT.setupFiles).toEqual(['./tests/setup-base.ts']);
    expect(DOM_PROJECT.setupFiles).toEqual(['./tests/setup-base.ts', './tests/setup-dom.ts']);
  });

  it('preserves the benchmark globs in the node project', () => {
    expect(NODE_PROJECT.benchmark.include).toContain('**/*.bench.{ts,tsx,js,jsx}');
    expect(NODE_PROJECT.benchmark.include).toContain('**/tests/performance/**/*.bench.{ts,tsx,js,jsx}');
  });

  it('still collects the .test and .spec patterns the suite used before', () => {
    expect(NODE_PROJECT.include).toContain('**/*.{test,spec}.{ts,tsx,js,jsx}');
  });
});
