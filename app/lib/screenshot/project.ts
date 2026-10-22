/*
 * Start a REAL project from a design or a screenshot.
 *
 * The old path wrote one throwaway `screenshot-generated.html` into the current project. That is a
 * dead end: an HTML file is not something you develop in Bolt, and a React output from the
 * screenshot-to-code backend is a CDN + Babel page whose scripts our import gate must strip, so it
 * arrived empty.
 *
 * The approach here is the one Bolt and Lovable both take: the image is a REFERENCE, and the
 * project is scaffolded from a template (React + TypeScript + Tailwind + shadcn/ui by default) by
 * the agent, in the normal chat pipeline. The user then owns a normal, developable project.
 */
import { STARTER_TEMPLATES } from '~/utils/constants';

/** The stack the user settled on. Overridable, but never exposed as a free-form choice. */
export const DEFAULT_PROJECT_TEMPLATE = 'Vite Shadcn';

/**
 * Which template to scaffold for a request.
 *
 * Framework names the user actually typed win (that is Bolt's own `selectStarterTemplate`
 * behaviour, and it keeps "build me an Astro blog" honest). Everything else lands on the React +
 * TypeScript + Tailwind + shadcn/ui default. Deliberately NOT inferred from the picture: a
 * screenshot says nothing about which framework you want to maintain.
 */
export function pickTemplate(prompt: string, fallback = DEFAULT_PROJECT_TEMPLATE): string {
  const requested: Array<[RegExp, string]> = [
    [/\bnext\.?js\b/i, 'NextJS Shadcn'],
    [/\bastro\b/i, 'Basic Astro'],
    [/\bexpo\b/i, 'Expo App'],
    [/\bremix\b/i, 'Remix Typescript'],
    [/\bqwik\b/i, 'Qwik Typescript'],
    [/\bsvelte(?:kit)?\b/i, 'Sveltekit'],
    [/\bvue(?:\.js)?\b/i, 'Vue'],
    [/\bangular\b/i, 'Angular'],
    [/\bsolid(?:js)?\b/i, 'SolidJS'],
  ];

  const hit = requested.find(([pattern]) => pattern.test(prompt));
  const name = hit ? hit[1] : fallback;

  /* A template that is not shipped by this deployment must not be promised to the user. */
  return STARTER_TEMPLATES.some((template) => template.name === name) ? name : fallback;
}

/** French label of a template, for the progress log. */
export function templateLabel(name: string): string {
  return STARTER_TEMPLATES.find((template) => template.name === name)?.label ?? name;
}

/**
 * The instruction handed to the agent once the project is scaffolded.
 *
 * Written as a normal user request so the whole existing pipeline applies (tools, preview, fix
 * loop). It names the stack, forbids inventing files outside it, and points at the image attached
 * to the message.
 */
export function buildProjectInstruction(args: {
  prompt: string;
  template: string;
  designCount: number;
  chosenIndex: number;
}): string {
  const label = templateLabel(args.template);

  const which =
    args.designCount > 1 ? ` (mockup ${args.chosenIndex + 1} of ${args.designCount}, the one the user picked)` : '';

  const userPrompt = args.prompt.trim();

  return [
    `Build this project with the ${label} stack: React, TypeScript, Tailwind CSS and shadcn/ui.`,
    `The attached image is the design to reproduce${which}.`,
    userPrompt ? `What the user asked for: ${userPrompt}.` : '',
    'Recreate the design as real components in the existing project, not as a single HTML file:',
    'split the page into components, put the copy in the components, and use shadcn/ui primitives',
    'where they fit. Keep the project installable and runnable as it is.',
  ]
    .filter(Boolean)
    .join(' ');
}
