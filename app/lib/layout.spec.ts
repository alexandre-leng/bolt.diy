import { describe, expect, it } from 'vitest';
import { COMPACT_LAYOUT_MAX_WIDTH, isCompactLayout } from './layout';

describe('isCompactLayout', () => {
  it('is true for phones and small tablets', () => {
    expect(isCompactLayout(390)).toBe(true);
    expect(isCompactLayout(768)).toBe(true);
    expect(isCompactLayout(COMPACT_LAYOUT_MAX_WIDTH - 1)).toBe(true);
  });

  it('is false from the desktop breakpoint up', () => {
    expect(isCompactLayout(COMPACT_LAYOUT_MAX_WIDTH)).toBe(false);
    expect(isCompactLayout(1440)).toBe(false);
  });

  it('is false when there is no window (server render)', () => {
    expect(isCompactLayout(undefined)).toBe(false);
  });
});
