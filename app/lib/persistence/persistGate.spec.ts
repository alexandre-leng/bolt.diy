import { describe, expect, it } from 'vitest';
import { messagesChangedSinceLoad } from './persistGate';

describe('messagesChangedSinceLoad', () => {
  it('is silent when the loaded messages are still the ones on screen', () => {
    const loaded = [{ id: 'a' }, { id: 'b' }];

    expect(messagesChangedSinceLoad(loaded, loaded)).toBe(false);
    expect(messagesChangedSinceLoad([], [])).toBe(false);
  });

  it('is true when a message was appended', () => {
    const loaded = [{ id: 'a' }];

    expect(messagesChangedSinceLoad([...loaded, { id: 'b' }], loaded)).toBe(true);
  });

  it('is true when the last message grew without a new one — the missed-save case', () => {
    const loaded = [{ id: 'a' }];

    // An agent continuation rewrites the last message in place: same length, new object.
    const extended = [{ id: 'a', parts: ['x'] }];

    expect(extended.length).toBe(loaded.length);
    expect(messagesChangedSinceLoad(extended, loaded)).toBe(true);
  });

  it('documents why a length-only guard missed the extended-message case', () => {
    const loaded = [{ id: 'a' }];
    const extended = [{ id: 'a', parts: ['x'] }];

    // The old condition was `messages.length > initialMessages.length`: false here, so the
    // save never ran even though the message on screen was no longer the one that was loaded.
    expect(extended.length > loaded.length).toBe(false);
    expect(messagesChangedSinceLoad(extended, loaded)).toBe(true);
  });

  it('is true when the list shrank (a failed turn was dropped)', () => {
    const loaded = [{ id: 'a' }, { id: 'b' }];

    expect(messagesChangedSinceLoad([{ id: 'a' }], loaded)).toBe(true);
  });
});
