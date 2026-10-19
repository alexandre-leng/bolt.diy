import { useId, useState, type PropsWithChildren } from 'react';

const ThoughtBox = ({ title, children }: PropsWithChildren<{ title: string }>) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const panelId = useId();

  return (
    <div
      className={`
        bg-bolt-elements-background-depth-2
        shadow-md
        rounded-lg
        transition-all
        duration-300
        ${isExpanded ? 'max-h-96' : 'max-h-13'}
        overflow-auto
        border border-bolt-elements-borderColor
      `}
    >
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={panelId}
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center gap-4 rounded-lg text-left text-bolt-elements-textSecondary font-medium leading-5 text-sm border border-bolt-elements-borderColor cursor-pointer"
      >
        <div aria-hidden="true" className="i-ph:brain-thin text-2xl" />
        <div className="div">
          <span> {title}</span>{' '}
          {!isExpanded && <span className="text-bolt-elements-textTertiary"> - Cliquer pour développer</span>}
        </div>
      </button>
      <div
        id={panelId}
        hidden={!isExpanded}
        className={`
        transition-opacity
        duration-300
        p-4
        rounded-lg
        ${isExpanded ? 'opacity-100' : 'opacity-0'}
      `}
      >
        {children}
      </div>
    </div>
  );
};

export default ThoughtBox;
