import { useState, useMemo, useCallback } from 'react';
import type { ChatHistoryItem } from '~/lib/persistence';
import { cleanChatTitle } from '~/utils/chatTitle';
import { debounce } from '~/utils/debounce';

interface UseSearchFilterOptions {
  items: ChatHistoryItem[];
  searchFields?: (keyof ChatHistoryItem)[];
  debounceMs?: number;
}

export function useSearchFilter({
  items = [],
  searchFields = ['description'],
  debounceMs = 300,
}: UseSearchFilterOptions) {
  const [searchQuery, setSearchQuery] = useState('');

  const debouncedSetSearch = useCallback(debounce(setSearchQuery, debounceMs), []);

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      debouncedSetSearch(event.target.value);
    },
    [debouncedSetSearch],
  );

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) {
      return items;
    }

    const query = searchQuery.toLowerCase();

    return items.filter((item) =>
      searchFields.some((field) => {
        const value = item[field];

        if (typeof value === 'string') {
          /*
           * Search what the user SEES: a stored title may still start with
           * « [Model: x] [Provider: y] », which typing « model » must not match.
           */
          const shown = field === 'description' ? cleanChatTitle(value) : value;

          return shown.toLowerCase().includes(query);
        }

        return false;
      }),
    );
  }, [items, searchQuery, searchFields]);

  return {
    searchQuery,
    filteredItems,
    handleSearchChange,
  };
}
