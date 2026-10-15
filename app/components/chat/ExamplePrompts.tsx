import React from 'react';

/*
 * Landing suggestions. Five, each with an icon, so they read as concrete
 * starting points rather than a wall of grey text. Literal class names only:
 * UnoCSS cannot see classes assembled at runtime.
 */
const EXAMPLE_PROMPTS = [
  { text: 'Build a personal portfolio', icon: 'i-ph:user-circle' },
  { text: 'Create a Kanban board in React', icon: 'i-ph:kanban' },
  { text: 'Make a recipe finder', icon: 'i-ph:cooking-pot' },
  { text: 'Build a markdown blog', icon: 'i-ph:article' },
  { text: 'Make a Pomodoro timer', icon: 'i-ph:timer' },
];

/**
 * Renders a collection of example prompt buttons that users can click to quickly start a conversation.
 *
 * @param sendMessage - Optional callback function to send a message when a prompt is clicked
 * @returns React component displaying example prompt buttons
 */
export function ExamplePrompts(sendMessage?: { (event: React.UIEvent, messageInput?: string): void | undefined }) {
  return (
    <div id="examples" className="w-full max-w-3xl mx-auto">
      {/* Phones: one horizontally scrollable row (Lovable); from 768px: centred, wrapping. */}
      <ul
        className="bolt-scroll-row flex flex-nowrap gap-2 overflow-x-auto -mx-4 px-4 pb-2 snap-x md:mx-0 md:px-0 md:flex-wrap md:justify-center md:overflow-visible animate-fade-in animation-delay-200"
        aria-label="Suggestions"
        tabIndex={0}
      >
        {EXAMPLE_PROMPTS.map((examplePrompt) => (
          <li key={examplePrompt.text} className="shrink-0 snap-start">
            <button
              type="button"
              onClick={(event) => {
                sendMessage?.(event, examplePrompt.text);
              }}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#eceae4] dark:border-white/10 bg-white/75 dark:bg-white/5 backdrop-blur-md px-3.5 py-1.5 text-sm text-[#1c1c1c] dark:text-white/90 shadow-xs transition-colors hover:bg-white dark:hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
            >
              <span className={`${examplePrompt.icon} text-base`} aria-hidden="true" />
              {examplePrompt.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
