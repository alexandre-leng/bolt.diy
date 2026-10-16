import { describe, expect, it } from 'vitest';
import { readTerminalLog } from './readTerminalLog';

describe('readTerminalLog', () => {
  it('copies the full active terminal scrollback, not only visible rows', () => {
    const rows = ['Browserslist: caniuse-lite is outdated', 'npm run dev', 'Local: http://localhost:5173'];

    const terminal = {
      buffer: {
        active: {
          length: rows.length,
          getLine: (index: number) => ({
            isWrapped: false,
            translateToString: () => rows[index],
          }),
        },
      },
    };

    expect(readTerminalLog(terminal)).toBe(rows.join('\n'));
  });

  it('joins wrapped lines without adding fake newlines and removes trailing empty rows', () => {
    const rows = [
      { text: 'Browserslist: caniuse-', wrapped: false },
      { text: 'lite is outdated', wrapped: true },
      { text: 'ready', wrapped: false },
      { text: '', wrapped: false },
      { text: '', wrapped: false },
    ];
    const terminal = {
      buffer: {
        active: {
          length: rows.length,
          getLine: (index: number) =>
            rows[index] && {
              isWrapped: rows[index].wrapped,
              translateToString: () => rows[index].text,
            },
        },
      },
    };

    expect(readTerminalLog(terminal)).toBe('Browserslist: caniuse-lite is outdated\nready');
  });

  it('returns empty text when no terminal is ready', () => {
    expect(readTerminalLog(undefined)).toBe('');
  });
});
