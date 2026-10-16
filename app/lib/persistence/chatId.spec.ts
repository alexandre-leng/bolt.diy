import { describe, expect, it } from 'vitest';
import { nextChatId } from './db';

describe('nextChatId', () => {
  it('does not hand two devices with the same history the same id', () => {
    // Desktop and phone both hold chats 1..8: "max + 1" gave both of them "9".
    const desktop = nextChatId(8, 1_792_180_000_000);
    const phone = nextChatId(8, 1_792_180_004_217);

    expect(desktop).not.toBe('9');
    expect(desktop).not.toBe(phone);
  });

  it('stays numeric and above every local id', () => {
    const id = nextChatId(1_792_180_000_500, 1_792_180_000_000);

    expect(id).toBe('1792180000501');
    expect(Number(id)).toBeGreaterThan(1_792_180_000_500);
  });
});
