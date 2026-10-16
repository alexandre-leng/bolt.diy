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
