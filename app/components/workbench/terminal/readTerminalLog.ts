import type { Terminal as XTerm } from '@xterm/xterm';

type TerminalLogSource = {
  buffer: {
    active: {
      length: number;
      getLine: (
        index: number,
      ) =>
        | Pick<NonNullable<ReturnType<XTerm['buffer']['active']['getLine']>>, 'isWrapped' | 'translateToString'>
        | undefined;
    };
  };
};

/** Copy the active terminal's scrollback, including output above the viewport. */
export function readTerminalLog(terminal: TerminalLogSource | undefined): string {
  if (!terminal) {
    return '';
  }

  const { active } = terminal.buffer;
  const lines: string[] = [];

  for (let index = 0; index < active.length; index++) {
    const line = active.getLine(index);

    if (!line) {
      continue;
    }

    const text = line.translateToString(true);

    if (line.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += text;
    } else {
      lines.push(text);
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}
