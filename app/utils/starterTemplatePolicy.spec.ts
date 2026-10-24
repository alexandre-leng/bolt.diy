import { describe, expect, it } from 'vitest';
import { shouldSelectStarterTemplate } from './starterTemplatePolicy';

describe('starter template policy for imported projects', () => {
  it('does not scaffold over an imported HTML application', () => {
    expect(shouldSelectStarterTemplate(true, { '/home/project/screenshot-generated.html': { type: 'file' } })).toBe(
      false,
    );
  });
  it('keeps the configured starter flow for a truly empty project', () => {
    expect(shouldSelectStarterTemplate(true, {})).toBe(true);
    expect(shouldSelectStarterTemplate(true, { '/home/project': { type: 'folder' } })).toBe(true);
  });
  it('respects the disabled auto-template preference', () => {
    expect(shouldSelectStarterTemplate(false, {})).toBe(false);
  });
});
