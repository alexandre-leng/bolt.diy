/*
 * Debug sessions: every conversation opened from a debug dispatcher carries a visible marker.
 *
 * A debug run (a probe, a screenshot harness, an automated check) sent real prompts to the
 * chat route, so every run persisted a real conversation in `bolt-history`, next to the
 * user's own work. They were distinguishable only by their prompt text, which is exactly the
 * thing the user cannot rely on: a debug prompt is often a plausible sentence, and the
 * production prompt it imitates is indistinguishable from it once the sidebar truncates both
 * to the same thirty characters.
 *
 * The rule below is what makes them identifiable instead. It is deliberately a pure function
 * of the messages, with no app or browser dependency, so the decision can be tested without
 * rendering anything:
 *
 *   1. A conversation whose FIRST user message carries the marker is a debug session, scope
 *      `chat`. The server-scoped marker that the debug tooling actually sends is
 *      `[Model: <name>] [Provider: <name>]` — the two on ONE line — see `DEBUG_SCOPE_RE`.
 *      `[Model:]` on its own is NOT a marker: production sends `[Model: x]\n\n[Provider: y]`
 *      on two lines for its own plumbing, and treating that as debug would flag every real
 *      conversation ever created.
 *   2. A conversation whose FIRST user message asks for a throwaway probe (a greeting, "say
 *      OK", a trivial echo — see `THROWAWAY_PROMPTS`) is a debug session, scope `probe`.
 *      Nothing was built in it and nothing will be.
 *
 * Scope `all` and `clear` exist for the debugger's own workflows: `all` on a conversation
 * that has no marker but is being driven by a debug run, `clear` to release a false positive.
 */

/*
 * The marker a debug dispatcher puts in its prompt: `[Model: x] [Provider: y]`, on ONE line.
 *
 * Every whitespace run below is `[ \t]`, never `\s`: `\s` also matches a newline, which made
 * this regex accept the two-line production plumbing `[Model: x]\n\n[Provider: y]` and would
 * have flagged every real conversation as debug.
 */
export const DEBUG_SCOPE_RE = /^[ \t]*(?:\[Model:[^\]]+\][ \t]+\[Provider:[^\]]+\]|\[debug[^\]]*\])/i;

/**
 * Prompts that build nothing: sending one is proof the conversation is a probe, not work.
 *
 * Matched against the FIRST user message, lowercased and stripped of its `[Model: x]` /
 * `[Provider: y]` plumbing. Deliberately narrow — a false positive labels real work as
 * debug, which is worse than leaving one probe unlabelled.
 */
const THROWAWAY_PROMPTS: RegExp[] = [
  /^(bonjour|salut|hello|hi|hey|coucou)\s*[.!?]*$/,
  /^dis\s+(simplement|juste)\s*:?\s*(bonjour|salut|ok|coucou)\s*[.!?]*$/,
  /^dis\s+(simplement|juste)\s+(bonjour|salut|ok)\s*[.!?]*$/,
  /^(bonjour|salut|hello),?\s+(r[ée]ponds?|r[ée]ponds?[- ]moi)\s+(juste\s+)?(ok|bonjour)\s*[.!?]*$/,
  /^(say|reply|respond|answer)\s+(just\s+)?(ok|hi|hello|bonjour)\s*[.!?]*$/,
];

export type DebugScope = 'chat' | 'probe' | 'all';

/** Strip the `[Model: …]` / `[Provider: …]` plumbing production prepends. */
export function stripPromptPlumbing(text: string): string {
  return text
    .replace(/\[Model:[^\]]*\]\s*/gi, '')
    .replace(/\[Provider:[^\]]*\]\s*/gi, '')
    .trim();
}

function firstUserText(messages: unknown[]): string | undefined {
  for (const message of messages) {
    const candidate = message as { role?: string; content?: unknown; parts?: unknown } | undefined;

    if (!candidate || candidate.role !== 'user') {
      continue;
    }

    if (typeof candidate.content === 'string' && candidate.content.trim()) {
      return candidate.content;
    }

    if (Array.isArray(candidate.parts)) {
      const text = candidate.parts
        .map((part) => (part as { type?: string; text?: unknown }) || {})
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text as string)
        .join(' ')
        .trim();

      if (text) {
        return text;
      }
    }
  }

  return undefined;
}

/**
 * Which debug scope, if any, this conversation deserves — computed from its messages, never
 * from a stored flag, so a conversation is identifiable even when its metadata is missing
 * (an older row, a local-only copy, a server copy pulled before the marker existed).
 */
export function detectDebugScope(messages: unknown[]): DebugScope | undefined {
  const first = firstUserText(messages);

  if (!first) {
    return undefined;
  }

  if (DEBUG_SCOPE_RE.test(first)) {
    return 'chat';
  }

  const bare = stripPromptPlumbing(first).toLowerCase();

  if (THROWAWAY_PROMPTS.some((pattern) => pattern.test(bare))) {
    return 'probe';
  }

  return undefined;
}

/** True when the conversation is a debug session and must not look like real work. */
export function isDebugChat(messages: unknown[]): boolean {
  return detectDebugScope(messages) !== undefined;
}
