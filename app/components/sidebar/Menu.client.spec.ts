import { describe, expect, it } from 'vitest';
import { listableChats, syncableChatIds } from './Menu.client';
import type { ChatHistoryItem } from '~/lib/persistence';

/**
 * Regression for "my conversation never reaches the server".
 *
 * The sidebar derived BOTH the list it renders and the ids it hands to
 * `migrateLocalHistoryToServer` from one filtered array (`urlId && description`). A chat
 * with no urlId is exactly the one that exists only in this browser — the one whose upload
 * is the whole point of the migration — so filtering first dropped precisely those records
 * and the server stayed empty. The two sets must be derived separately, and these tests
 * pin that, because collapsing them again would look like a harmless tidy-up.
 */
const chat = (over: Partial<ChatHistoryItem>): ChatHistoryItem =>
  ({ id: 'id', messages: [{ role: 'user' }], timestamp: '2026-07-01T00:00:00Z', ...over }) as ChatHistoryItem;

describe('listableChats vs syncableChatIds', () => {
  it('hides a chat that has no urlId yet from the list', () => {
    const items = [chat({ id: 'local-only' }), chat({ id: 'ready', urlId: '2-aaa-0', description: 'Titre' })];

    expect(listableChats(items).map((i) => i.id)).toEqual(['ready']);
  });

  it('still hands the local-only chat to the migration', () => {
    const items = [chat({ id: 'local-only' }), chat({ id: 'ready', urlId: '2-aaa-0', description: 'Titre' })];

    // THE regression: this list must contain the chat the display filter removed.
    expect(syncableChatIds(items)).toContain('local-only');
    expect(syncableChatIds(items)).toEqual(['local-only', 'ready']);
  });

  it('hides a chat with a urlId but no description from the list, and still migrates it', () => {
    const items = [chat({ id: 'untitled', urlId: '2-bbb-0' })];

    expect(listableChats(items)).toHaveLength(0);
    expect(syncableChatIds(items)).toEqual(['untitled']);
  });

  it('keeps every id, so nothing cached is silently skipped', () => {
    const items = [chat({ id: 'a' }), chat({ id: 'b' }), chat({ id: 'c', urlId: 'u', description: 'd' })];

    expect(syncableChatIds(items)).toHaveLength(items.length);
  });

  it('handles an empty cache', () => {
    expect(listableChats([])).toEqual([]);
    expect(syncableChatIds([])).toEqual([]);
  });
});
