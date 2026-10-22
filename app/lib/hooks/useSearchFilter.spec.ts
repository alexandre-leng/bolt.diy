import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSearchFilter } from './useSearchFilter';

/*
 * A-02: the search must filter on the title the user SEES. A stored title may still begin with
 * « [Model: x] [Provider: y] »; typing « model » must not match every such conversation.
 */
const items = [
  { id: '1', description: '[Model: beam-free] [Provider: OpenCodeGo] créer un site', messages: [], timestamp: '' },
  { id: '2', description: 'Un jeu de cartes', messages: [], timestamp: '' },
];

afterEach(() => vi.useRealTimers());

function search(query: string) {
  vi.useFakeTimers();

  const { result } = renderHook(() => useSearchFilter({ items: items as never, debounceMs: 10 }));

  act(() => {
    result.current.handleSearchChange({ target: { value: query } } as never);
    vi.advanceTimersByTime(20);
  });

  return result.current.filteredItems.map((item) => item.id);
}

describe('useSearchFilter sur les titres nettoyés', () => {
  it('trouve la conversation par son vrai titre', () => {
    expect(search('créer')).toEqual(['1']);
  });

  it('ne fait pas correspondre les marqueurs techniques invisibles', () => {
    expect(search('model')).toEqual([]);
    expect(search('opencodego')).toEqual([]);
  });
});
