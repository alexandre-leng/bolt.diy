import { useStore } from '@nanostores/react';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Panel, type PanelImperativeHandle } from 'react-resizable-panels';
import { RestartPreviewButton } from './RestartPreviewButton';
import { Terminal, type TerminalRef } from './Terminal';
import { TerminalManager } from './TerminalManager';
import { readTerminalLog } from './readTerminalLog';
import { IconButton } from '~/components/ui/IconButton';
import { themeStore } from '~/lib/stores/theme';
import { workbenchStore } from '~/lib/stores/workbench';
import { toast } from '~/lib/toastify';
import { classNames } from '~/utils/classNames';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('Terminal');

const MAX_TERMINALS = 3;
export const DEFAULT_TERMINAL_SIZE = 25;

const MINIMIZED_TERMINAL_SIZE = '34px';
const MINIMIZED_TERMINAL_HEIGHT = 34;

export const TerminalTabs = memo(() => {
  const showTerminal = useStore(workbenchStore.showTerminal);
  const theme = useStore(themeStore);

  const terminalRefs = useRef<Map<number, TerminalRef>>(new Map());
  const terminalPanelRef = useRef<PanelImperativeHandle>(null);

  const [activeTerminal, setActiveTerminal] = useState(0);
  const [terminalCount, setTerminalCount] = useState(0);
  const [isMinimized, setIsMinimized] = useState(!showTerminal);

  const copyTerminalLog = async () => {
    const terminal = terminalRefs.current.get(activeTerminal)?.getTerminal();
    const content = readTerminalLog(terminal);

    if (!content) {
      toast.info('Le terminal ne contient aucune sortie à copier.');

      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      toast.success('Journaux du terminal copiés.');
    } catch {
      toast.error('Impossible de copier les journaux du terminal. Vérifiez l’autorisation du presse-papiers.');
    }
  };

  const addTerminal = () => {
    if (terminalCount < MAX_TERMINALS) {
      setTerminalCount(terminalCount + 1);
      setActiveTerminal(terminalCount);
    }
  };

  const closeTerminal = useCallback(
    (index: number) => {
      if (index === 0) {
        return;
      } // Can't close bolt terminal

      const terminalRef = terminalRefs.current.get(index);

      if (terminalRef?.getTerminal) {
        const terminal = terminalRef.getTerminal();

        if (terminal) {
          workbenchStore.detachTerminal(terminal);
        }
      }

      // Remove the terminal from refs
      terminalRefs.current.delete(index);

      // Adjust terminal count and active terminal
      setTerminalCount(terminalCount - 1);

      if (activeTerminal === index) {
        setActiveTerminal(Math.max(0, index - 1));
      } else if (activeTerminal > index) {
        setActiveTerminal(activeTerminal - 1);
      }
    },
    [activeTerminal, terminalCount],
  );

  useEffect(() => {
    return () => {
      terminalRefs.current.forEach((ref, index) => {
        if (index > 0 && ref?.getTerminal) {
          const terminal = ref.getTerminal();

          if (terminal) {
            workbenchStore.detachTerminal(terminal);
          }
        }
      });
    };
  }, []);

  useEffect(() => {
    const { current: terminal } = terminalPanelRef;

    if (!terminal) {
      return;
    }

    const terminalSize = terminal.getSize().inPixels;

    if (!showTerminal && terminalSize > MINIMIZED_TERMINAL_HEIGHT) {
      terminal.resize(MINIMIZED_TERMINAL_SIZE);
    } else if (showTerminal && terminalSize <= MINIMIZED_TERMINAL_HEIGHT) {
      terminal.resize(`${DEFAULT_TERMINAL_SIZE}%`);
    }
  }, [showTerminal]);

  useEffect(() => {
    const unsubscribeFromThemeStore = themeStore.subscribe(() => {
      terminalRefs.current.forEach((ref) => {
        ref?.reloadStyles();
      });
    });

    return () => {
      unsubscribeFromThemeStore();
    };
  }, []);

  return (
    <Panel
      panelRef={terminalPanelRef}
      defaultSize={showTerminal ? DEFAULT_TERMINAL_SIZE : MINIMIZED_TERMINAL_SIZE}
      minSize={MINIMIZED_TERMINAL_SIZE}
      onResize={(size) => {
        const minimized = size.inPixels <= MINIMIZED_TERMINAL_HEIGHT + 1;
        setIsMinimized(minimized);

        if (workbenchStore.showTerminal.get() !== !minimized) {
          workbenchStore.toggleTerminal(!minimized);
        }
      }}
    >
      {isMinimized && (
        <div className="h-full min-h-[44px] flex items-center justify-end bg-bolt-elements-background-depth-2 border-t border-bolt-elements-borderColor px-2">
          <button
            type="button"
            className="flex min-h-11 items-center gap-2 px-3 py-1 rounded-md bg-transparent text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-terminals-buttonBackground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-focus"
            title="Développer le terminal"
            onClick={() => {
              terminalPanelRef.current?.resize(`${DEFAULT_TERMINAL_SIZE}%`);
              workbenchStore.toggleTerminal(true);
            }}
          >
            <div className="i-ph:terminal-window-duotone text-lg" />
            <span>Terminal</span>
            <div className="i-ph:caret-up text-sm" />
          </button>
        </div>
      )}
      <div className={classNames('h-full', { hidden: isMinimized })}>
        <div className="bg-bolt-elements-terminals-background h-full flex flex-col">
          <div className="flex items-center bg-bolt-elements-background-depth-2 border-y border-bolt-elements-borderColor gap-1.5 min-h-[44px] p-2">
            <div
              role="tablist"
              aria-label="Terminaux"
              aria-orientation="horizontal"
              className="flex items-center gap-1.5"
            >
              {Array.from({ length: terminalCount + 1 }, (_, index) => {
                const isActive = activeTerminal === index;

                return (
                  <React.Fragment key={index}>
                    {index == 0 ? (
                      <button
                        key={index}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={classNames(
                          'flex items-center text-sm cursor-pointer gap-1.5 px-3 py-2 min-h-11 whitespace-nowrap rounded-full',
                          {
                            'bg-bolt-elements-terminals-buttonBackground text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary':
                              isActive,
                            'bg-bolt-elements-background-depth-2 text-bolt-elements-textSecondary hover:bg-bolt-elements-terminals-buttonBackground':
                              !isActive,
                          },
                        )}
                        onClick={() => setActiveTerminal(index)}
                      >
                        <div className="i-ph:terminal-window-duotone text-lg" />
                        Terminal Bolt
                      </button>
                    ) : (
                      <React.Fragment>
                        {/*
                        Two sibling buttons, never a button inside a button: the nested shape is
                        invalid HTML and its accessible name was empty, so a screen reader announced
                        an unnamed button and a click could both select and close the tab. The
                        container carries the pill styling; each button owns one action.
                      */}
                        <div
                          className={classNames(
                            'flex items-center text-sm cursor-pointer gap-1.5 px-3 py-2 min-h-11 whitespace-nowrap rounded-full',
                            {
                              'bg-bolt-elements-terminals-buttonBackground text-bolt-elements-textPrimary': isActive,
                              'bg-bolt-elements-background-depth-2 text-bolt-elements-textSecondary hover:bg-bolt-elements-terminals-buttonBackground':
                                !isActive,
                            },
                          )}
                        >
                          <button
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            aria-label={`Terminal ${index}`}
                            className="flex min-h-11 items-center gap-1.5 cursor-pointer"
                            onClick={() => setActiveTerminal(index)}
                          >
                            <div className="i-ph:terminal-window-duotone text-lg" />
                            Terminal {terminalCount > 1 && index}
                          </button>
                          <button
                            type="button"
                            aria-label={`Fermer le terminal ${index}`}
                            title={`Fermer le terminal ${index}`}
                            className="bg-transparent text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary hover:bg-transparent rounded cursor-pointer min-h-11 min-w-11 inline-flex items-center justify-center"
                            onClick={(e) => {
                              e.stopPropagation();
                              closeTerminal(index);
                            }}
                          >
                            <div className="i-ph:x text-xs" />
                          </button>
                        </div>
                      </React.Fragment>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            {terminalCount < MAX_TERMINALS && (
              <IconButton
                icon="i-ph:plus"
                size="md"
                aria-label="Nouveau terminal"
                title="Nouveau terminal"
                onClick={addTerminal}
              />
            )}
            <button
              type="button"
              onClick={() => void copyTerminalLog()}
              aria-label="Copier les journaux du terminal"
              title="Copier les journaux du terminal"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-transparent px-2 text-xs font-medium text-bolt-elements-textPrimary hover:bg-bolt-elements-terminals-buttonBackground focus-visible:outline focus-visible:outline-2 focus-visible:outline-bolt-elements-focus"
            >
              <span className="i-ph:copy text-base" aria-hidden="true" />
              <span className="hidden sm:inline">Copier les journaux</span>
            </button>
            <RestartPreviewButton
              onRestart={async () => {
                setActiveTerminal(0);

                const { restartProjectPreview } = await import('~/lib/runtime/projectMcp');
                await restartProjectPreview();
              }}
            />
            <IconButton
              className="ml-auto"
              icon="i-ph:minus"
              title="Réduire le terminal"
              size="md"
              onClick={() => {
                terminalPanelRef.current?.resize(MINIMIZED_TERMINAL_SIZE);
                workbenchStore.toggleTerminal(false);
              }}
            />
          </div>
          {Array.from({ length: terminalCount + 1 }, (_, index) => {
            const isActive = activeTerminal === index;

            logger.debug(`Starting bolt terminal [${index}]`);

            if (index == 0) {
              return (
                <React.Fragment key={`terminal-container-${index}`}>
                  <Terminal
                    key={`terminal-${index}`}
                    id={`terminal_${index}`}
                    className={classNames('h-full overflow-hidden modern-scrollbar-invert', {
                      hidden: !isActive,
                    })}
                    ref={(ref) => {
                      if (ref) {
                        terminalRefs.current.set(index, ref);
                      }
                    }}
                    onTerminalReady={(terminal) => workbenchStore.attachBoltTerminal(terminal)}
                    onTerminalResize={(cols, rows) => workbenchStore.onTerminalResize(cols, rows)}
                    theme={theme}
                  />
                  <TerminalManager
                    terminal={terminalRefs.current.get(index)?.getTerminal() || null}
                    isActive={isActive}
                  />
                </React.Fragment>
              );
            } else {
              return (
                <React.Fragment key={`terminal-container-${index}`}>
                  <Terminal
                    key={`terminal-${index}`}
                    id={`terminal_${index}`}
                    className={classNames('modern-scrollbar h-full overflow-hidden', {
                      hidden: !isActive,
                    })}
                    ref={(ref) => {
                      if (ref) {
                        terminalRefs.current.set(index, ref);
                      }
                    }}
                    onTerminalReady={(terminal) => workbenchStore.attachTerminal(terminal)}
                    onTerminalResize={(cols, rows) => workbenchStore.onTerminalResize(cols, rows)}
                    theme={theme}
                  />
                  <TerminalManager
                    terminal={terminalRefs.current.get(index)?.getTerminal() || null}
                    isActive={isActive}
                  />
                </React.Fragment>
              );
            }
          })}
        </div>
      </div>
    </Panel>
  );
});
