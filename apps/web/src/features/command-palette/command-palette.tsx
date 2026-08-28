import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';

import { categoryRepository } from '../categories/category-repository';
import { noteRepository } from '../notes/note-repository';
import { searchService } from '../search/search-service';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PaletteSectionMeta {
  type: 'section';
  label: string;
}

interface PaletteNoteItem {
  type: 'note';
  id: string;
  title: string;
  preview: string;
}

interface PaletteCategoryItem {
  type: 'category';
  id: string;
  name: string;
}

interface PaletteActionItem {
  type: 'action';
  id: string;
  label: string;
  description?: string;
}

type PaletteItem =
  | PaletteSectionMeta
  | PaletteNoteItem
  | PaletteCategoryItem
  | PaletteActionItem;

export function CommandPalette({
  isOpen,
  onClose,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const allCategories = useLiveQuery(
    () => categoryRepository.list(),
    [],
    [],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setQuery('');
    setSelectedIndex(0);

    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const searchResults = useMemo(() => {
    if (!query.trim()) {
      return [];
    }

    return searchService.search(query).slice(0, 5);
  }, [query]);

  const matchingCategories = useMemo(() => {
    if (!query.trim()) {
      return [];
    }

    const q = query.toLocaleLowerCase();

    return allCategories
      .filter((cat) => cat.name.toLocaleLowerCase().includes(q))
      .slice(0, 5);
  }, [query, allCategories]);

  const items = useMemo(() => {
    const result: PaletteItem[] = [];
    const hasQuery = query.trim().length > 0;

    if (searchResults.length > 0) {
      result.push({ type: 'section', label: 'Notes' });

      for (const note of searchResults) {
        result.push({
          type: 'note',
          id: note.id,
          title: note.title,
          preview: note.preview,
        });
      }
    }

    if (matchingCategories.length > 0) {
      result.push({ type: 'section', label: 'Categories' });

      for (const cat of matchingCategories) {
        result.push({
          type: 'category',
          id: cat.id,
          name: cat.name,
        });
      }
    }

    result.push({ type: 'section', label: 'Actions' });

    if (hasQuery) {
      result.push({
        type: 'action',
        id: 'create-note',
        label: 'Create note',
        description: query,
      });
    }

    if (hasQuery) {
      result.push({
        type: 'action',
        id: 'create-category',
        label: 'Create category',
        description: query,
      });
    }

    result.push({
      type: 'action',
      id: 'go-conflicts',
      label: 'Open conflicts',
    });

    result.push({
      type: 'action',
      id: 'go-all-notes',
      label: 'Go to All Notes',
    });

    result.push({
      type: 'action',
      id: 'go-uncategorized',
      label: 'Go to Uncategorized',
    });

    return result;
  }, [searchResults, matchingCategories, query]);

  const selectableItems = useMemo(
    () => items.filter(
      (item): item is PaletteNoteItem | PaletteCategoryItem | PaletteActionItem =>
        item.type !== 'section',
    ),
    [items],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex(
        (current) => Math.min(current + 1, selectableItems.length - 1),
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const selected = selectableItems[selectedIndex];

      if (!selected) {
        return;
      }

      if (selected.type === 'note') {
        void openNote(selected.id);
      } else if (selected.type === 'category') {
        void navigateToCategory(selected.id);
      } else if (selected.type === 'action') {
        void executeAction(selected.id);
      }
    }
  }

  async function openNote(noteId: string) {
    await navigate({
      to: '/notes/$noteId',
      params: { noteId },
    });
    onClose();
  }

  async function navigateToCategory(categoryId: string) {
    await navigate({
      to: '/',
      search: { category: categoryId },
    });
    onClose();
  }

  async function executeAction(actionId: string) {
    if (actionId === 'create-note') {
      const noteId = await noteRepository.create({
        title: query,
      });
      await navigate({
        to: '/notes/$noteId',
        params: { noteId },
      });
      onClose();
      return;
    }

    if (actionId === 'create-category') {
      await categoryRepository.create({
        name: query,
      });
      onClose();
      return;
    }

    if (actionId === 'go-conflicts') {
      await navigate({ to: '/conflicts' });
      onClose();
      return;
    }

    if (actionId === 'go-all-notes') {
      await navigate({ to: '/', search: { category: undefined } });
      onClose();
      return;
    }

    if (actionId === 'go-uncategorized') {
      await navigate({
        to: '/',
        search: { category: 'uncategorized' },
      });
      onClose();
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/30 px-3 py-16 backdrop-blur-sm sm:px-6"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="mx-auto flex max-h-[min(680px,calc(100vh-8rem))] max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
          <div className="border-b border-slate-200 p-4">
            <label className="block">
              <span className="sr-only">Search</span>
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search notes, categories, or run a command..."
                className="w-full border-0 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
              />
            </label>
          </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <ul className="space-y-1">
            {(() => {
              let selectableCounter = -1;

              return items.map((item) => {
                if (item.type === 'section') {
                  return (
                    <li
                      key={`palette-section-${item.label}`}
                      className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400"
                    >
                      {item.label}
                    </li>
                  );
                }

                selectableCounter++;
                const isSelected = selectableCounter === selectedIndex;

                if (item.type === 'note') {
                  return (
                    <li key={`note-${item.id}`}>
                      <button
                        type="button"
                        onClick={() => void openNote(item.id)}
                        className={`w-full rounded-md px-3 py-3 text-left transition ${
                          isSelected
                            ? 'bg-slate-100'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {item.title}
                        </span>
                        {item.preview ? (
                          <span className="mt-1 block truncate text-xs text-slate-400">
                            {item.preview}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                }

                if (item.type === 'category') {
                  return (
                    <li key={`cat-${item.id}`}>
                      <button
                        type="button"
                        onClick={() => void navigateToCategory(item.id)}
                        className={`w-full rounded-md px-3 py-3 text-left transition ${
                          isSelected
                            ? 'bg-slate-100'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {item.name}
                        </span>
                      </button>
                    </li>
                  );
                }

                if (item.type === 'action') {
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => void executeAction(item.id)}
                        className={`w-full rounded-md px-3 py-3 text-left transition ${
                          isSelected
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="block text-sm font-medium">
                          {item.label}
                        </span>
                        {item.description ? (
                          <span className="mt-1 block truncate text-xs text-slate-400">
                            {item.description}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                }

                return null;
              });
            })()}
          </ul>
        </div>
      </div>
    </div>
  );
}
