/**
 * Whether a message list differs from the one that was loaded.
 *
 * Upstream asked only `messages.length > initialMessages.length`, so a turn that *extends*
 * the last message instead of appending one — an Agent-mode continuation, an auto-approved
 * tool output, a stream resumed after a reconnect — never satisfied it: the messages and the
 * snapshot stopped being written for the rest of that turn. Comparing the last message's
 * identity covers those cases while staying silent when nothing changed.
 */
export function messagesChangedSinceLoad<T>(messages: readonly T[], initialMessages: readonly T[]): boolean {
  if (messages.length !== initialMessages.length) {
    return true;
  }

  if (messages.length === 0) {
    return false;
  }

  return messages[messages.length - 1] !== initialMessages[initialMessages.length - 1];
}
