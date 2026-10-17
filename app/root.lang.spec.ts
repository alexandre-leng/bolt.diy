import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The UI is French; with <html lang="en"> screen readers read it with an English voice and
 * the browser dictated in English (audit U13). Asserted on the source: rendering Layout
 * needs a full router + data context for a one-attribute check.
 */
describe('root layout language', () => {
  it('declares French on <html>', () => {
    const source = readFileSync(fileURLToPath(new URL('./root.tsx', import.meta.url)), 'utf8');
    const htmlTag = source.match(/<html[\s\S]*?>/)?.[0] ?? '';

    expect(htmlTag).toMatch(/lang="fr"/);
  });
});
