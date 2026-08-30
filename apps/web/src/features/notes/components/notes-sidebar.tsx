import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useSearch,
} from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  createNotePreview,
  type Note,
  type TemplateType,
} from '@bigmind/domain/notes';
import {
  buildCategoryTree,
  type CategoryTreeNode,
} from '@bigmind/domain/categories';
import { clearRecentNotes, getRecentNotes } from '../recent-store';
import {
  getFavoriteNotes,
  isFavorite,
  toggleFavoriteNote,
} from '../favorites-store';

import { useAuth } from '../../auth/auth-context';
import { WorkspaceSwitcher } from '../../workspaces/workspace-switcher';
import {
  CategoryDialog,
  type CategoryDialogAction,
} from '../../categories/category-dialog';
import { categoryRepository } from '../../categories/category-repository';
import {
  storage,
  type CategoryRecord,
  type NoteRecord,
} from '../../../storage';
import { noteRepository } from '../note-repository';
import { searchService } from '../../search/search-service';
import { Highlight } from '../../search/search-highlight';
import type { SearchResult } from '../../search/search.types';
import { SyncStatus } from '../../../sync/sync-status';
import { ConflictIndicator } from '../../../sync/conflict-indicator';
import { NotificationCenter } from '../../notifications/notification-center';
import { Icon } from '../../../components/icon';

interface NotesSidebarProps {
  className?: string;
  onNavigate?: () => void;
}
interface DialogState {
  action: CategoryDialogAction;
  category?: CategoryRecord;
  parentId?: string | null;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

export function NotesSidebar({
  className = '',
  onNavigate,
}: NotesSidebarProps) {
  const navigate = useNavigate();
  const auth = useAuth();
  const location = useLocation();
  const search = useSearch({ strict: false }) as { category?: string };
  const [searchQuery, setSearchQuery] = useState('');
  const [dialog, setDialog] = useState<DialogState>();
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const templateRef = useRef<HTMLDivElement>(null);
  const categories = useLiveQuery(() => categoryRepository.list(), []) ?? [];
  const categoryMatch = location.pathname.match(/^\/categories\/([^/]+)$/);
  const categoryFromRoute = categoryMatch ? categoryMatch[1] : undefined;
  const validCategory =
    categories.some(({ id }) => id === search.category) ||
    categories.some(({ id }) => id === categoryFromRoute);
  const selected: string =
    search.category === 'uncategorized'
      ? 'uncategorized'
      : validCategory
        ? (search.category ?? categoryFromRoute ?? 'all')
        : 'all';

  const isSearching = searchQuery.trim().length > 0;
  const debouncedSearch = useDebounce(searchQuery, 200);

  useEffect(() => {
    void searchService.initialize();
  }, []);

  const searchResults = useMemo(() => {
    if (!isSearching || !debouncedSearch.trim()) return null;
    return searchService.search(debouncedSearch);
  }, [debouncedSearch, isSearching]);

  const filteredSearchResults = useLiveQuery(async () => {
    if (!searchResults) return undefined;
    if (!searchResults.length) return [];

    const ids = searchResults.map((r) => r.id);
    const notes = await storage.notes.bulkGet(ids);
    const noteMap = new Map(
      notes
        .filter((n): n is NoteRecord => n !== undefined)
        .map((n) => [n.id, n]),
    );

    return searchResults.filter((r) => {
      const note = noteMap.get(r.id);
      if (!note || note.deletedAt) return false;
      if (selected === 'all') return true;
      const target = selected === 'uncategorized' ? null : selected;
      return note.categoryId === target;
    });
  }, [searchResults, selected]);

  const categoryNotes = useLiveQuery(async () => {
    if (isSearching) return undefined;
    return noteRepository.list({
      ...(selected === 'uncategorized'
        ? { categoryId: null }
        : selected !== 'all'
          ? { categoryId: selected }
          : {}),
    });
  }, [isSearching, selected]);

  async function selectCategory(category?: string) {
    if (category && category !== 'all' && category !== 'uncategorized') {
      await navigate({
        to: '/categories/$categoryId',
        params: { categoryId: category },
      });
    } else {
      await navigate({ to: '/', search: { category } });
    }
    onNavigate?.();
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        templateRef.current &&
        !templateRef.current.contains(event.target as Node)
      ) {
        setTemplateMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleCreateNote(templateType?: TemplateType) {
    const noteId = await noteRepository.create({
      categoryId:
        selected !== 'all' && selected !== 'uncategorized' ? selected : null,
      templateType: templateType ?? 'MARKDOWN',
    });
    setTemplateMenuOpen(false);
    await navigate({ to: '/notes/$noteId', params: { noteId } });
    onNavigate?.();
  }

  return (
    <aside
      className={`min-h-0 flex-col border-r border-outline-variant bg-surface-low ${className}`}
    >
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/"
            search={{ category: undefined }}
            onClick={onNavigate}
            className="text-2xl font-semibold leading-8 tracking-tight text-on-surface"
          >
            BigMind
          </Link>
          <div ref={templateRef} className="relative">
            <button
              type="button"
              onClick={() => setTemplateMenuOpen((v) => !v)}
              aria-label="Create a new note"
              className="flex size-9 items-center justify-center rounded-full bg-primary text-on-primary shadow-sm transition hover:opacity-90 active:scale-95"
            >
              <Icon name="add" className="text-[20px]" />
            </button>
            {templateMenuOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg border border-outline-variant bg-surface-lowest py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => void handleCreateNote('MARKDOWN')}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-on-surface transition hover:bg-surface-high"
                >
                  <Icon
                    name="sticky_note_2"
                    className="text-[18px] text-on-surface-variant"
                  />
                  <span>Markdown Note</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateNote('TODO_LIST')}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-on-surface transition hover:bg-surface-high"
                >
                  <Icon
                    name="checklist"
                    className="text-[18px] text-on-surface-variant"
                  />
                  <span>Todo List</span>
                </button>
                <button
                  type="button"
                  onClick={() => void navigate({ to: '/agenda' })}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-on-surface transition hover:bg-surface-high"
                >
                  <Icon
                    name="alarm"
                    className="text-[18px] text-on-surface-variant"
                  />
                  <span>Reminder</span>
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="mt-1">
          <WorkspaceSwitcher />
        </div>
        <label className="mt-3 block">
          <span className="sr-only">Search notes</span>
          <div className="relative">
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search notes..."
              className="w-full rounded-lg border border-outline-variant bg-surface-lowest px-3 py-2 pr-10 text-sm text-on-surface outline-none transition focus:border-primary"
            />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-outline-variant bg-surface-low px-1.5 py-0.5 text-[10px] font-medium text-outline">
              ⌘K
            </kbd>
          </div>
        </label>
      </div>

      <Favorites onNavigate={onNavigate} />
      <RecentNotes onNavigate={onNavigate} />

      <div className="border-t border-outline-variant/50 px-2 py-2">
        <div className="px-3 py-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-on-surface-variant">
            Categories
          </span>
        </div>
        <nav className="space-y-0.5">
          <CategoryButton
            icon="sticky_note_2"
            active={selected === 'all'}
            label="All Notes"
            onClick={() => void selectCategory()}
          />
          <CategoryButton
            icon="folder"
            active={selected === 'uncategorized'}
            label="Uncategorized"
            onClick={() => void selectCategory('uncategorized')}
          />
          {buildCategoryTree(categories).map((category) => (
            <CategoryBranch
              key={category.id}
              category={category}
              records={categories}
              selected={selected}
              onSelect={(id) => void selectCategory(id)}
              onAction={setDialog}
            />
          ))}
        </nav>
        <button
          type="button"
          onClick={() => setDialog({ action: 'create' })}
          className="mx-3 mt-2 flex w-[calc(100%-1.5rem)] items-center justify-center gap-2 rounded-lg border border-dashed border-outline px-4 py-2 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-highest"
        >
          <Icon name="add" className="text-[18px]" />
          New category
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-2">
        {isSearching ? (
          <>
            {filteredSearchResults === undefined && (
              <p className="px-3 py-4 text-sm text-outline">Loading notes...</p>
            )}
            {filteredSearchResults?.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-on-surface-variant">
                No notes found
              </p>
            )}
            {filteredSearchResults && filteredSearchResults.length > 0 && (
              <ul className="space-y-1">
                {filteredSearchResults.map((result) => (
                  <SearchResultItem
                    key={result.id}
                    result={result}
                    query={debouncedSearch}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            {categoryNotes === undefined && (
              <p className="px-3 py-4 text-sm text-outline">Loading notes...</p>
            )}
            {categoryNotes?.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-on-surface-variant">
                No notes yet
              </p>
            )}
            {categoryNotes && categoryNotes.length > 0 && (
              <ul className="space-y-1">
                {categoryNotes.map((note) => (
                  <NoteItem key={note.id} note={note} onNavigate={onNavigate} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <footer className="mt-auto border-t border-outline-variant px-2 py-2">
        <div className="flex items-center justify-between px-2 pb-2">
          <SyncStatus />
          <div className="flex items-center gap-1">
            <NotificationCenter />
            <ConflictIndicator />
          </div>
        </div>
        <FooterRow
          icon="settings"
          label="Settings"
          to="/settings"
          onNavigate={onNavigate}
        />
        <FooterRow
          icon="event"
          label="Agenda"
          to="/agenda"
          onNavigate={onNavigate}
        />
        <FooterRow
          icon="sync_problem"
          label="Conflicts"
          to="/conflicts"
          onNavigate={onNavigate}
        />
        <button
          type="button"
          onClick={() => {
            auth.logout();
            navigate({ to: '/login' });
          }}
          className="flex w-full items-center gap-3 px-4 py-2 text-left text-error transition-colors hover:bg-surface-highest active:scale-95"
        >
          <Icon name="logout" className="text-[20px]" />
          <span className="text-sm font-semibold">Logout</span>
        </button>
      </footer>
      {dialog && (
        <CategoryDialog
          {...dialog}
          categories={categories}
          onClose={() => setDialog(undefined)}
        />
      )}
    </aside>
  );
}

function FooterRow({
  icon,
  label,
  to,
  onNavigate,
}: {
  icon: string;
  label: string;
  to: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className="flex items-center gap-3 px-4 py-2 text-on-surface-variant transition-colors hover:bg-surface-highest hover:text-on-surface active:scale-95"
    >
      <Icon name={icon} className="text-[20px]" />
      <span className="text-sm font-semibold">{label}</span>
    </Link>
  );
}

function CategoryButton({
  active,
  label,
  depth = 0,
  icon,
  onClick,
  actions,
}: {
  active: boolean;
  label: string;
  depth?: number;
  icon?: string;
  onClick: () => void;
  actions?: React.ReactNode;
}) {
  const isMaterialIcon = icon ? /^[a-z0-9_]+$/.test(icon) : false;

  return (
    <div
      className={`group flex items-center border-l-4 transition-colors ${
        active
          ? 'border-primary bg-surface-high text-primary'
          : 'border-transparent text-on-surface-variant hover:bg-surface-highest hover:text-on-surface'
      }`}
      style={{ paddingLeft: depth * 12 }}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
      >
        {icon ? (
          isMaterialIcon ? (
            <Icon name={icon} className="text-[20px]" />
          ) : (
            <span className="text-[20px] leading-none">{icon}</span>
          )
        ) : null}
        <span
          className={`truncate text-sm ${active ? 'font-bold' : 'font-semibold'}`}
        >
          {label}
        </span>
      </button>
      {actions}
    </div>
  );
}

function CategoryBranch({
  category,
  records,
  selected,
  onSelect,
  onAction,
  depth = 0,
}: {
  category: CategoryTreeNode;
  records: CategoryRecord[];
  selected: string;
  onSelect: (id: string) => void;
  onAction: (state: DialogState) => void;
  depth?: number;
}) {
  const record = records.find(({ id }) => id === category.id);
  const actions = record ? (
    <div
      className={`${selected === category.id ? 'flex' : 'hidden group-hover:flex'} shrink-0 gap-1 pr-1`}
    >
      <button
        type="button"
        title="New subcategory"
        aria-label={`New subcategory in ${category.name}`}
        onClick={() => onAction({ action: 'create', parentId: category.id })}
        className="px-1 text-xs"
      >
        +
      </button>
      <button
        type="button"
        title="Rename"
        onClick={() => onAction({ action: 'rename', category: record })}
        className="px-1 text-xs"
      >
        Rename
      </button>
      <button
        type="button"
        title="Move"
        onClick={() => onAction({ action: 'move', category: record })}
        className="px-1 text-xs"
      >
        Move
      </button>
      <button
        type="button"
        title="Delete"
        onClick={() => onAction({ action: 'delete', category: record })}
        className="px-1 text-xs text-error"
      >
        Delete
      </button>
    </div>
  ) : undefined;
  return (
    <div>
      <CategoryButton
        active={selected === category.id}
        label={category.name}
        icon={category.icon ?? undefined}
        depth={depth}
        onClick={() => onSelect(category.id)}
        actions={actions}
      />
      {category.children.map((child) => (
        <CategoryBranch
          key={child.id}
          category={child}
          records={records}
          selected={selected}
          onSelect={onSelect}
          onAction={onAction}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function Favorites({ onNavigate }: { onNavigate?: () => void }) {
  const [favorites, setFavorites] = useState(() => getFavoriteNotes());

  useEffect(() => {
    function handleChange() {
      setFavorites(getFavoriteNotes());
    }
    window.addEventListener('favorites-changed', handleChange);
    return () => window.removeEventListener('favorites-changed', handleChange);
  }, []);

  if (favorites.length === 0) return null;

  return (
    <div className="border-t border-outline-variant/50 px-2 py-2">
      <div className="px-3 py-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-on-surface-variant">
          Favorites
        </span>
      </div>
      <ul className="space-y-0.5">
        {favorites.map((note) => (
          <li key={note.id}>
            <Link
              to="/notes/$noteId"
              params={{ noteId: note.id }}
              onClick={onNavigate}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-on-surface transition hover:bg-surface-highest"
            >
              <Icon name="star" className="text-[16px] text-yellow-500" />
              <span className="min-w-0 flex-1 truncate">{note.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentNotes({ onNavigate }: { onNavigate?: () => void }) {
  const [recents, setRecents] = useState(() => getRecentNotes());

  useEffect(() => {
    function handleChange() {
      setRecents(getRecentNotes());
    }
    window.addEventListener('recents-changed', handleChange);
    return () => window.removeEventListener('recents-changed', handleChange);
  }, []);

  if (recents.length === 0) return null;

  return (
    <div className="border-t border-outline-variant/50 px-2 py-2">
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-on-surface-variant">
          Recents
        </span>
        <button
          type="button"
          onClick={() => clearRecentNotes()}
          className="text-[10px] text-outline hover:text-error"
        >
          Clear
        </button>
      </div>
      <ul className="space-y-0.5">
        {recents.map((note) => (
          <li key={note.id}>
            <Link
              to="/notes/$noteId"
              params={{ noteId: note.id }}
              onClick={onNavigate}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-on-surface transition hover:bg-surface-highest"
            >
              <Icon
                name={
                  note.templateType === 'TODO_LIST'
                    ? 'checklist'
                    : 'sticky_note_2'
                }
                className="text-[16px] text-on-surface-variant"
              />
              <span className="min-w-0 flex-1 truncate">{note.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoteItem({
  note,
  onNavigate,
}: {
  note: Note;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const syncStatus = (note as Note & { syncStatus?: string }).syncStatus;
  const isConflicted = syncStatus === 'conflict';
  const noteId = note.id;
  const fav = isFavorite(noteId);
  const [showDelete, setShowDelete] = useState(false);

  async function handleDelete() {
    await noteRepository.delete(noteId);
    setShowDelete(false);
    window.dispatchEvent(new CustomEvent('recents-changed'));
    window.dispatchEvent(new CustomEvent('favorites-changed'));
    navigate({ to: '/', search: { category: undefined } });
  }

  return (
    <>
      <li className="group relative">
        <Link
          to="/notes/$noteId"
          params={{ noteId }}
          onClick={onNavigate}
          activeProps={{
            className:
              'block rounded-lg bg-surface-lowest px-3 py-2 shadow-sm ring-1 ring-outline-variant/60',
          }}
          inactiveProps={{
            className:
              'block rounded-lg px-3 py-2 transition hover:bg-surface-highest',
          }}
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-on-surface">
              {note.title}
            </span>
            {isConflicted ? (
              <span
                className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700"
                title="Synchronization conflict"
              >
                !
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-xs text-outline">
            {createNotePreview(note.content)}
          </div>
        </Link>

        <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              const r = toggleFavoriteNote({
                id: noteId,
                title: note.title,
                templateType: (note as any).templateType ?? 'MARKDOWN',
              });
              if (!r.error)
                window.dispatchEvent(new CustomEvent('favorites-changed'));
            }}
            title={fav ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
            className={`rounded p-0.5 text-sm ${fav ? 'text-yellow-500' : 'text-slate-300 hover:text-yellow-500'}`}
          >
            <Icon name={fav ? 'star' : 'star_border'} className="text-[16px]" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setShowDelete(true);
            }}
            title="Delete note"
            aria-label="Delete note"
            className="rounded p-0.5 text-sm text-slate-300 hover:text-red-500"
          >
            <Icon name="close" className="text-[16px]" />
          </button>
        </div>
      </li>

      {showDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={() => setShowDelete(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-note-sidebar-title"
            className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2
              id="delete-note-sidebar-title"
              className="text-base font-semibold text-slate-900"
            >
              Delete this note?
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              This note will be removed from your local notes and queued for
              sync deletion.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDelete(false)}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                Delete note
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SearchResultItem({
  result,
  query,
  onNavigate,
}: {
  result: SearchResult;
  query: string;
  onNavigate?: () => void;
}) {
  return (
    <li>
      <Link
        to="/notes/$noteId"
        params={{ noteId: result.id }}
        onClick={onNavigate}
        activeProps={{
          className:
            'block rounded-lg bg-surface-lowest px-3 py-2 shadow-sm ring-1 ring-outline-variant/60',
        }}
        inactiveProps={{
          className:
            'block rounded-lg px-3 py-2 transition hover:bg-surface-highest',
        }}
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-on-surface">
            <Highlight text={result.title} query={query} />
          </span>
        </div>
        <div className="mt-1 truncate text-xs text-outline">
          <Highlight text={result.preview} query={query} />
        </div>
      </Link>
    </li>
  );
}
