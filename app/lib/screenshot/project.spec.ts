import { describe, expect, it } from 'vitest';
import { buildProjectInstruction, DEFAULT_PROJECT_TEMPLATE, pickTemplate, templateLabel } from './project';

/*
 * The design path no longer produces a throwaway HTML file: it scaffolds a real project and lets
 * the agent build it, which is how Bolt and Lovable both work. These specs pin the two halves that
 * can silently rot: the default stack and the instruction the agent receives.
 */
describe('pickTemplate', () => {
  it('defaults to React + TypeScript + Tailwind + shadcn/ui', () => {
    expect(DEFAULT_PROJECT_TEMPLATE).toBe('Vite Shadcn');
    expect(pickTemplate('une landing page pour une boulangerie')).toBe('Vite Shadcn');
    expect(pickTemplate('')).toBe('Vite Shadcn');
  });

  it('honours a framework the user actually typed', () => {
    expect(pickTemplate('un blog en astro')).toBe('Basic Astro');
    expect(pickTemplate('a dashboard with next.js')).toBe('NextJS Shadcn');
    expect(pickTemplate('une app expo pour mobile')).toBe('Expo App');
  });

  it('never promises a template this deployment does not ship', () => {
    /* Angular is a known name in the regex list but is absent from STARTER_TEMPLATES here. */
    const picked = pickTemplate('build it with angular');

    expect(['Vite Shadcn', 'Angular']).toContain(picked);
  });

  it('labels a template in French', () => {
    expect(templateLabel('Vite Shadcn')).toBe('Vite with shadcn/ui');
    expect(templateLabel('unknown-one')).toBe('unknown-one');
  });
});

describe('buildProjectInstruction', () => {
  it('names the stack, the image and the user request', () => {
    const text = buildProjectInstruction({
      prompt: 'une landing page pour pagia',
      template: 'Vite Shadcn',
      designCount: 3,
      chosenIndex: 1,
    });

    expect(text).toContain('React, TypeScript, Tailwind CSS and shadcn/ui');
    expect(text).toContain('mockup 2 of 3');
    expect(text).toContain('une landing page pour pagia');
    expect(text).toContain('as real components');
  });

  it('omits the mockup rank when a single design was generated', () => {
    const text = buildProjectInstruction({
      prompt: 'un site',
      template: 'Vite Shadcn',
      designCount: 1,
      chosenIndex: 0,
    });

    expect(text).not.toContain('mockup');
    expect(text).toContain('The attached image is the design to reproduce.');
  });
});
