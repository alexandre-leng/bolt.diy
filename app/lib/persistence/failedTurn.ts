/**
 * What to keep of a turn that ended in an error, before the user's next message is sent.
 *
 * Upstream drops the last message unconditionally. In Agent mode that message can hold tool
 * calls that already wrote files into the project: dropping it erased the only record of
 * those writes, so the history no longer explained the project and a reopened chat could not
 * rebuild it. Settled tool calls are now kept; only calls that never got a result are removed,
 * because an unanswered tool call would make the next request invalid.
 */
type AnyPart = { type?: string; state?: string } & Record<string, unknown>;
type AnyMessage = { role?: string; parts?: AnyPart[] } & Record<string, unknown>;

const SETTLED_TOOL_STATES = new Set(['output-available', 'output-error', 'output-denied']);

function isToolPart(part: AnyPart): boolean {
  return part?.type === 'dynamic-tool' || (typeof part?.type === 'string' && part.type.startsWith('tool-'));
}

export function dropFailedTurn<T extends object>(messages: T[]): T[] {
  const last = messages.at(-1) as (T & AnyMessage) | undefined;

  if (!last) {
    return messages;
  }

  if (last.role !== 'assistant') {
    return messages.slice(0, -1);
  }

  const parts = (last.parts || []).filter((part) => !isToolPart(part) || SETTLED_TOOL_STATES.has(part.state ?? ''));
  const wroteSomething = parts.some((part) => isToolPart(part) && part.state === 'output-available');

  if (!wroteSomething) {
    return messages.slice(0, -1);
  }

  return [...messages.slice(0, -1), { ...last, parts } as T];
}
