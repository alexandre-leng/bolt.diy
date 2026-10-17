import type { UIMessageChunk } from 'ai';

/**
 * Whether a response that stopped on `finishReason` should be continued with a new text
 * segment ("Continue your prior response…").
 *
 * Not in agent mode. The continuation pushes the truncated answer back as a plain-text
 * assistant message plus a new user message, and the agent loop reads its progress (plan,
 * edits, checks) only from what follows the LAST user message — so the continuation started
 * from nothing: no plan, edits forgotten, the model forced to plan again and redo the work.
 * In agent mode the turn ends instead; its tool results are kept and the next request
 * resumes the loop from them.
 */
export function shouldContinueSegment(args: { finishReason: string | undefined; agentLoopActive: boolean }): boolean {
  return args.finishReason === 'length' && !args.agentLoopActive;
}

/**
 * Plays `first`, then every segment `next()` hands out (in order), as ONE UI stream, with a
 * single `finish` chunk — the last one seen — at the very end.
 *
 * Continuations used to be merged next to the first segment, whose `finish` therefore reached
 * the client before the continuation's text (the client then treats the message as done).
 * `next()` is read once the previous segment has ended: streamText awaits its onEnd before
 * closing its stream, so a continuation queued there is always visible here.
 */
export function chainSegments(
  first: ReadableStream<UIMessageChunk>,
  next: () => ReadableStream<UIMessageChunk> | undefined,
): ReadableStream<UIMessageChunk> {
  let current: ReadableStreamDefaultReader<UIMessageChunk> | undefined = first.getReader();
  let finish: UIMessageChunk | undefined;

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      while (current) {
        const { done, value } = await current.read();

        if (done) {
          current.releaseLock();
          current = next()?.getReader();
          continue;
        }

        if (value.type === 'finish') {
          finish = value;
          continue;
        }

        controller.enqueue(value);

        return;
      }

      if (finish) {
        controller.enqueue(finish);
      }

      controller.close();
    },
    async cancel(reason) {
      await current?.cancel(reason);
    },
  });
}
