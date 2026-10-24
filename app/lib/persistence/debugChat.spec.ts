import { describe, expect, it } from 'vitest';

/*
 * The debug marker is only worth having if it never fires on real work, so most of these
 * tests pin the NEGATIVE case: a production conversation must not be labelled.
 */
import { DEBUG_SCOPE_RE, detectDebugScope, isDebugChat, stripPromptPlumbing } from './debugChat';

function firstUser(content: string) {
  return [{ role: 'user', content }];
}

describe('detectDebugScope', () => {
  it('flags the server-scoped marker a debug dispatcher sends', () => {
    expect(
      detectDebugScope(firstUser('[Model: deepseek-v4.1-flash] [Provider: OpenCodeGo] Construis une landing page')),
    ).toBe('chat');
  });

  it('flags an explicit [debug] tag', () => {
    expect(detectDebugScope(firstUser('[debug: sidebar probe] Corrige le bouton'))).toBe('chat');
  });

  it('does NOT flag production plumbing, which puts the two tags on separate lines', () => {
    const production = '[Model: deepseek-v4.1-flash]\n\n[Provider: OpenCodeGo]\n\nConstruis une landing page';

    expect(detectDebugScope(firstUser(production))).toBeUndefined();
  });

  it('does NOT flag a real build request that merely mentions a model', () => {
    expect(detectDebugScope(firstUser('Use [Model: gpt-4] for this site, please build a gallery'))).toBeUndefined();
  });

  it('flags a throwaway greeting as a probe', () => {
    expect(detectDebugScope(firstUser('Bonjour'))).toBe('probe');
    expect(detectDebugScope(firstUser('Dis simplement: bonjour'))).toBe('probe');
    expect(detectDebugScope(firstUser('Bonjour, reponds juste OK.'))).toBe('probe');
  });

  it('flags a throwaway greeting even behind production plumbing', () => {
    const content = '[Model: deepseek-v4.1-flash]\n\n[Provider: OpenCodeGo]\n\nDis simplement: bonjour';

    expect(detectDebugScope(firstUser(content))).toBe('probe');
  });

  it('does not treat a real request that starts with a greeting as a probe', () => {
    expect(detectDebugScope(firstUser('Bonjour, construis-moi une landing page pour une boulangerie'))).toBeUndefined();
  });

  it('reads the text out of parts when content is empty', () => {
    const messages = [
      { role: 'assistant', content: '' },
      { role: 'user', parts: [{ type: 'text', text: 'Salut' }] },
    ];

    expect(detectDebugScope(messages)).toBe('probe');
  });

  it('returns nothing for an empty conversation or one with no user turn', () => {
    expect(detectDebugScope([])).toBeUndefined();
    expect(detectDebugScope([{ role: 'assistant', content: 'Hi' }])).toBeUndefined();
  });

  it('is available as a boolean for the sidebar', () => {
    expect(isDebugChat(firstUser('[Model: a] [Provider: b] x'))).toBe(true);
    expect(isDebugChat(firstUser('Construis une landing page'))).toBe(false);
  });
});

describe('stripPromptPlumbing', () => {
  it('removes both tags and the blank lines they leave behind', () => {
    expect(stripPromptPlumbing('[Model: x]\n\n[Provider: y]\n\nBonjour')).toBe('Bonjour');
  });
});

describe('DEBUG_SCOPE_RE', () => {
  it('requires both tags on one line', () => {
    expect(DEBUG_SCOPE_RE.test('[Model: x] [Provider: y] go')).toBe(true);
    expect(DEBUG_SCOPE_RE.test('[Model: x]\n\n[Provider: y]\n\n go')).toBe(false);
  });
});
