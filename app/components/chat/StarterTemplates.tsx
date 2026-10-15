import React from 'react';
import type { Template } from '~/types/template';
import { STARTER_TEMPLATES } from '~/utils/constants';

interface FrameworkLinkProps {
  template: Template;
}

/*
 * Labelled template pills (icon + name). The previous grey, unlabelled icons
 * could only be identified by hovering for a tooltip.
 */
const FrameworkLink: React.FC<FrameworkLinkProps> = ({ template }) => (
  <a
    href={`/starter?template=${encodeURIComponent(template.name)}`}
    aria-label={`Start a blank ${template.label} app`}
    data-discover="true"
    className="group inline-flex shrink-0 snap-start items-center gap-2 rounded-full border border-[#eceae4] dark:border-white/10 bg-white/75 dark:bg-white/5 backdrop-blur-md px-3.5 py-2 text-sm text-[#1c1c1c] dark:text-white/90 transition-colors hover:bg-white dark:hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
  >
    <span
      className={`${template.icon} inline-block w-5 h-5 shrink-0 opacity-80 transition-opacity group-hover:opacity-100`}
      aria-hidden="true"
    />
    <span className="whitespace-nowrap">{template.label}</span>
  </a>
);

const StarterTemplates: React.FC = () => {
  return (
    <section className="flex flex-col items-center gap-3 w-full max-w-4xl" aria-labelledby="starter-templates-title">
      <h2 id="starter-templates-title" className="text-sm font-medium text-[#1c1c1c]/80 dark:text-white/80">
        Start from a template
      </h2>
      <div
        className="bolt-scroll-row flex flex-nowrap gap-2 overflow-x-auto w-[calc(100%+2rem)] -mx-4 px-4 pb-2 snap-x md:w-auto md:mx-0 md:px-0 md:flex-wrap md:justify-center md:overflow-visible"
        role="region"
        aria-label="Starter templates (scroll for more)"
        tabIndex={0}
      >
        {STARTER_TEMPLATES.map((template) => (
          <FrameworkLink key={template.name} template={template} />
        ))}
      </div>
    </section>
  );
};

export default StarterTemplates;
