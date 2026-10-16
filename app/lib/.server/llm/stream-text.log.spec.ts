import { describe, expect, it } from 'vitest';
import { summarizeOptionsForLog } from './stream-text';

describe('summarizeOptionsForLog', () => {
  it('never puts the system prompt, tools or callbacks into the log', () => {
    const system = '<web_research_tools>secret project context</web_research_tools>'.repeat(20);

    const summary = summarizeOptionsForLog({
      system,
      temperature: 0.2,
      maxOutputTokens: 8000,
      toolChoice: 'required',
      tools: { project_write_file: {} },
      onError: () => undefined,
      messages: [1, 2, 3],
      providerOptions: undefined,
    });

    const text = JSON.stringify(summary);

    expect(text).not.toContain('secret project context');
    expect(summary).toEqual({
      system: `<string ${system.length}>`,
      temperature: 0.2,
      maxOutputTokens: 8000,
      toolChoice: 'required',
      tools: '<object 1 keys>',
      onError: '<function>',
      messages: '<array 3>',
      providerOptions: '<undefined>',
    });
  });

  it('hides a short system prompt too', () => {
    expect(summarizeOptionsForLog({ system: 'short' })).toEqual({ system: '<string 5>' });
  });
});
