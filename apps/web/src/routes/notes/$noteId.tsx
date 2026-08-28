import { lazy, Suspense, type FocusEvent, type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { UNTITLED_NOTE_TITLE } from '@bigmind/domain/notes';
import { buildCategoryTree, type CategoryTreeNode } from '@bigmind/domain/categories';
import { Icon } from '../../components/icon';

const MarkdownEditor = lazy(() => import('../../features/notes/components/markdown-editor').then((m) => ({ default: m.MarkdownEditor })));
const TodoEditor = lazy(() => import('../../features/todos/todo-editor').then((m) => ({ default: m.TodoEditor })));
import { categoryRepository } from '../../features/categories/category-repository';
import { conflictRepository } from '../../features/conflicts/conflict-repository';
import { noteRepository } from '../../features/notes/note-repository';
import { useNoteAutosave } from '../../features/notes/use-note-autosave';
import { useWorkspaces } from '../../features/workspaces/workspace-context';
import { moveNote, copyNote } from '../../features/notes/note-client';
import { recordRecentNote, removeRecentNote } from '../../features/notes/recent-store';
import { isFavorite, toggleFavoriteNote } from '../../features/notes/favorites-store';
import type { SaveStatus as SaveStatusValue } from '../../features/notes/use-note-autosave';
import { NoteLinksPanel } from '../../features/links/note-links-panel';

interface SaveStatusProps {
  status: SaveStatusValue;
}

interface NoteTimestampProps {
  createdAt: string;
  updatedAt?: string;
}

const noteDateFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const noteTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeStyle: 'short',
});

function SaveStatus({ status }: SaveStatusProps) {
  const labels: Record<SaveStatusValue, string> = {
    idle: 'Unsaved changes',
    saving: 'Saving locally...',
    saved: 'Saved locally',
    error: 'Unable to save',
  };

  const dotColor: Record<SaveStatusValue, string> = {
    idle: 'bg-amber-500',
    saving: 'bg-amber-500',
    saved: 'bg-green-500',
    error: 'bg-error',
  };

  return (
    <span className="flex items-center gap-1.5" role="status">
      <span className={`size-2 rounded-full ${dotColor[status]}`} />
      <span className={status === 'error' ? 'text-xs text-error' : 'text-xs text-on-surface-variant'}>
        {labels[status]}
      </span>
    </span>
  );
}

function NoteTimestamp({ createdAt, updatedAt }: NoteTimestampProps) {
  const hasBeenUpdated = Boolean(updatedAt && updatedAt !== createdAt);
  const timestamp = hasBeenUpdated && updatedAt ? updatedAt : createdAt;

  return (
    <span className="text-xs text-on-surface-variant">
      {hasBeenUpdated ? 'Last edited' : 'Created'}{' '}
      <time dateTime={timestamp}>
        {noteDateFormatter.format(new Date(timestamp))}
      </time>
    </span>
  );
}

export const Route = createFileRoute('/notes/$noteId')({
  loader: async ({ params }) => {
    const note = await noteRepository.findById(params.noteId);

    if (!note) {
      throw notFound();
    }

    return {
      noteId: note.id,
    };
  },
  component: NotePage,
});

function NotePage() {
  const { noteId } = Route.useLoaderData();
  const navigate = useNavigate();

  const note = useLiveQuery(() => noteRepository.findById(noteId), [noteId]);
  const categories = useLiveQuery(() => categoryRepository.list(), []) ?? [];
  const noteSuggestions = useLiveQuery(() => noteRepository.list(), []) ?? [];
  const openConflictsForNote = useLiveQuery(
    async () => {
      const conflicts = await conflictRepository.listOpen();
      return conflicts.filter((conflict) => conflict.entityId === noteId);
    },
    [noteId],
  );

  const { workspaces, currentWorkspace } = useWorkspaces();
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [workspaceAction, setWorkspaceAction] = useState<'move' | 'copy' | null>(null);
  const [workspaceError, setWorkspaceError] = useState('');
  const [isFav, setIsFav] = useState(false);
  const [favError, setFavError] = useState('');

  useEffect(() => {
    setIsFav(isFavorite(noteId));
    setFavError('');
  }, [noteId]);

  function handleToggleFavorite() {
    if (note) {
      const result = toggleFavoriteNote({
        id: note.id,
        title: note.title,
        templateType: note.templateType,
      });
      setIsFav(result.added);
      setFavError(result.error ?? '');
      window.dispatchEvent(new CustomEvent('favorites-changed'));
      if (result.error) {
        setTimeout(() => setFavError(''), 3000);
      }
    }
  }

  const { status: saveStatus, scheduleSave } = useNoteAutosave({
    noteId,
    delay: 600,
  });

  async function handleConfirmDelete() {
    await noteRepository.delete(noteId);
    removeRecentNote(noteId);

    await navigate({
      to: '/',
      search: { category: undefined },
    });
  }

  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setCategoryId(note.categoryId ?? '');
      if (note.syncStatus !== 'pending') {
        recordRecentNote({ id: note.id, title: note.title, templateType: note.templateType });
      }
    }
  }, [note]);

  if (note === undefined) {
    return <p className="text-sm text-slate-500">Loading note...</p>;
  }

  if (!note) {
    return (
      <section>
        <h1 className="text-2xl font-semibold">Note not found</h1>

        <Link
          to="/"
          search={{ category: undefined }}
          className="mt-4 inline-block text-blue-600 hover:underline"
        >
          Back to notes
        </Link>
      </section>
    );
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    if (value.trim()) {
      scheduleSave({ title: value });
    }
  }

  function handleTitleFocus(event: FocusEvent<HTMLInputElement>) {
    if (event.currentTarget.value === UNTITLED_NOTE_TITLE) {
      event.currentTarget.select();
    }
  }

  function handleTitleMouseUp(event: MouseEvent<HTMLInputElement>) {
    if (event.currentTarget.value === UNTITLED_NOTE_TITLE) {
      event.preventDefault();
    }
  }

  function handleContentChange(markdown: string) {
    scheduleSave({ content: markdown });
  }

  function handleCategoryChange(categoryId: string) {
    setCategoryId(categoryId);
    scheduleSave({ categoryId: categoryId || null });
  }

  async function handleFabCreate() {
    const newNoteId = await noteRepository.create({
      categoryId: note?.categoryId ?? null,
      templateType: note?.templateType ?? 'MARKDOWN',
    });
    await navigate({ to: '/notes/$noteId', params: { noteId: newNoteId } });
  }

  const categoryName = note?.categoryId
    ? categories.find((c) => c.id === note.categoryId)?.name ?? 'Category'
    : null;

  return (
    <>
      <article className="mx-auto max-w-4xl">
        {openConflictsForNote && openConflictsForNote.length > 0 ? (
          <ConflictBanner
            conflictId={openConflictsForNote[0].id}
            onDismiss={async () => {
              await conflictRepository.dismiss(openConflictsForNote[0].id);
            }}
          >
            This note has synchronization conflicts.
          </ConflictBanner>
        ) : null}

        {/* Top bar: back + breadcrumb + actions */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            {note && note.categoryId ? (
              <Link
                to="/categories/$categoryId"
                params={{ categoryId: note.categoryId }}
                aria-label={`Back to ${categoryName}`}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-primary transition hover:bg-surface-high"
              >
                <Icon name="arrow_back" className="text-[20px]" />
              </Link>
            ) : (
              <Link
                to="/"
                search={{ category: undefined }}
                aria-label="Back to all notes"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-primary transition hover:bg-surface-high"
              >
                <Icon name="arrow_back" className="text-[20px]" />
              </Link>
            )}
            <nav className="flex min-w-0 items-center gap-1 text-sm">
              {note && note.categoryId ? (
                <Link
                  to="/categories/$categoryId"
                  params={{ categoryId: note.categoryId }}
                  className="truncate font-bold text-primary"
                >
                  {categoryName}
                </Link>
              ) : (
                <Link
                  to="/"
                  search={{ category: undefined }}
                  className="truncate font-bold text-primary"
                >
                  All notes
                </Link>
              )}
              <Icon name="chevron_right" className="shrink-0 text-[16px] text-outline" />
              <span className="truncate text-on-surface-variant">Editor</span>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {favError && (
              <div className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">{favError}</div>
            )}
            <button
              type="button"
              onClick={handleToggleFavorite}
              aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
              title={isFav ? 'Remove from favorites' : 'Add to favorites (max 5)'}
              className={`flex size-9 items-center justify-center rounded-lg transition hover:bg-surface-high ${isFav ? 'text-yellow-500' : 'text-outline hover:text-yellow-500'}`}
            >
              <Icon name="star" filled={isFav} className="text-[20px]" />
            </button>

            {(currentWorkspace?.role === 'OWNER' || currentWorkspace?.role === 'EDITOR') && (
              <>
                <button
                  type="button"
                  onClick={() => { setWorkspaceAction('move'); setWorkspaceError(''); }}
                  className="text-xs font-medium text-on-surface-variant hover:text-on-surface"
                >
                  Move To
                </button>
                <button
                  type="button"
                  onClick={() => { setWorkspaceAction('copy'); setWorkspaceError(''); }}
                  className="text-xs font-medium text-on-surface-variant hover:text-on-surface"
                >
                  Copy To
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setIsDeleteDialogOpen(true)}
              className="text-xs font-medium text-error hover:opacity-80"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Metadata + title */}
        <div className="mb-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {categoryName ? (
              <>
                <span className="rounded-full bg-secondary-container px-2 py-1 text-xs font-semibold text-on-secondary-container">
                  {categoryName}
                </span>
                <span className="text-xs text-outline">•</span>
              </>
            ) : null}
            <NoteTimestamp createdAt={note.createdAt} updatedAt={note.updatedAt} />
          </div>
          <input
            type="text"
            value={title}
            onChange={(event) => handleTitleChange(event.target.value)}
            onFocus={handleTitleFocus}
            onMouseUp={handleTitleMouseUp}
            placeholder={UNTITLED_NOTE_TITLE}
            aria-label="Note title"
            className="w-full border-0 bg-transparent text-[32px] font-bold leading-10 tracking-[-0.02em] text-on-surface outline-none placeholder:text-slate-300"
          />
        </div>

        <div className="mb-3 flex justify-end">
          <SearchableCategorySelect
            categories={buildCategoryTree(categories)}
            value={categoryId}
            onChange={handleCategoryChange}
          />
        </div>

        {/* Editor — todo items are cards themselves; markdown gets the white card */}
        <div style={{ display: note?.templateType === 'TODO_LIST' ? 'block' : 'none' }}>
          <Suspense fallback={<div className="py-8 text-center text-sm text-outline">Loading editor…</div>}>
            <TodoEditor noteId={noteId} />
          </Suspense>
        </div>
        <div
          style={{ display: note?.templateType === 'MARKDOWN' ? 'block' : 'none' }}
          className="rounded-xl border border-outline-variant bg-surface-lowest shadow-sm"
        >
          {note && (
            <Suspense fallback={<div className="py-8 text-center text-sm text-outline">Loading editor…</div>}>
              <div className="p-4">
                <MarkdownEditor
                  key={note.id}
                  initialValue={note.content}
                  onChange={handleContentChange}
                  noteSuggestions={noteSuggestions}
                />
              </div>
            </Suspense>
          )}
        </div>

        {note?.templateType === 'MARKDOWN' && <NoteLinksPanel noteId={note.id} />}

        {/* Bottom workspace status */}
        <div className="mt-2 flex items-center justify-between px-1">
          <SaveStatus status={saveStatus} />
          <span className="text-xs text-outline">
            Autosaved at{' '}
            <time dateTime={note.updatedAt || note.createdAt}>
              {noteTimeFormatter.format(new Date(note.updatedAt || note.createdAt))}
            </time>
          </span>
        </div>
      </article>

      {/* Floating Action Button */}
      <button
        type="button"
        onClick={() => void handleFabCreate()}
        aria-label="Create a new note"
        title="Create a new note"
        className="fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-lg transition-transform hover:scale-110 active:scale-95"
      >
        <Icon name="add" className="text-[28px]" />
      </button>

      {isDeleteDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={() => setIsDeleteDialogOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-note-title"
            className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2
              id="delete-note-title"
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
                onClick={() => setIsDeleteDialogOpen(false)}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                Delete note
              </button>
            </div>
          </div>
        </div>
      )}

      {workspaceAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={() => { setWorkspaceAction(null); setWorkspaceError(''); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-slate-900">
              {workspaceAction === 'move' ? 'Move Note To Workspace' : 'Copy Note To Workspace'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Select the destination workspace:
            </p>

            <div className="mt-3 max-h-60 space-y-1 overflow-y-auto">
              {workspaces
                .filter((ws) => ws.id !== currentWorkspace?.id)
                .map((ws) => (
                  <button
                    key={ws.id}
                    type="button"
                    disabled={ws.role === 'VIEWER'}
                    onClick={async () => {
                      setWorkspaceError('');
                      try {
                        if (workspaceAction === 'move') {
                          await moveNote(noteId, ws.id);
                          await navigate({ to: '/', search: { category: undefined } });
                        } else {
                          await copyNote(noteId, ws.id);
                          setWorkspaceAction(null);
                        }
                      } catch (err) {
                        setWorkspaceError(err instanceof Error ? err.message : 'Operation failed');
                      }
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition hover:bg-slate-100 disabled:opacity-50"
                  >
                    <span className="font-medium text-slate-800">{ws.name}</span>
                    <span className="text-xs text-slate-400">{ws.role}</span>
                  </button>
                ))}
            </div>

            {workspaceError && (
              <p className="mt-3 text-sm text-red-600">{workspaceError}</p>
            )}

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => { setWorkspaceAction(null); setWorkspaceError(''); }}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface ConflictBannerProps {
  conflictId: string;
  onDismiss: () => Promise<void>;
  children: React.ReactNode;
}

function ConflictBanner({ conflictId, onDismiss, children }: ConflictBannerProps) {
  const [isBusy, setIsBusy] = useState(false);

  async function handleDismiss() {
    setIsBusy(true);
    try {
      await onDismiss();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-medium">{children}</p>
      <div className="flex items-center gap-2">
        <Link
          to="/conflicts/$conflictId"
          params={{ conflictId }}
          className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
        >
          Review conflict
        </Link>
        <button
          type="button"
          onClick={() => void handleDismiss()}
          disabled={isBusy}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-amber-700 hover:text-amber-900 disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function flattenCategories(
  categories: CategoryTreeNode[],
  depth = 0,
): { category: CategoryTreeNode; depth: number }[] {
  return categories.flatMap((category) => [
    { category, depth },
    ...flattenCategories(category.children, depth + 1),
  ]);
}

interface SearchableCategorySelectProps {
  categories: CategoryTreeNode[];
  value: string;
  onChange: (categoryId: string) => void;
}

function SearchableCategorySelect({
  categories,
  value,
  onChange,
}: SearchableCategorySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => buildCategoryTree(categories), [categories]);

  const flat = useMemo(() => flattenCategories(tree), [tree]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return flat;
    const q = searchQuery.toLocaleLowerCase();
    return flat.filter(({ category }) =>
      category.name.toLocaleLowerCase().includes(q),
    );
  }, [flat, searchQuery]);

  const selectedLabel = value
    ? flat.find(({ category }) => category.id === value)?.category.name ?? 'Uncategorized'
    : 'Uncategorized';

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      setIsOpen(false);
    }
  }

  return (
    <div className="relative flex items-center gap-2 text-xs text-slate-500" onKeyDown={handleKeyDown}>
      <span className="shrink-0">Category</span>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 transition hover:border-slate-400"
      >
        <span className="max-w-36 truncate">{selectedLabel}</span>
        <svg className={`size-3 shrink-0 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl" style={{ minWidth: '14rem' }}>
            <div className="border-b border-slate-200 p-2">
              <input
                ref={inputRef}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search categories..."
                className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <ul className="max-h-48 overflow-y-auto p-1">
              <li>
                <button
                  type="button"
                  onClick={() => { onChange(''); setIsOpen(false); }}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                    value === ''
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Uncategorized
                </button>
              </li>
              {filtered.map(({ category, depth }) => (
                <li key={category.id}>
                  <button
                    type="button"
                    onClick={() => { onChange(category.id); setIsOpen(false); }}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                      value === category.id
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                    style={{ paddingLeft: `${12 + depth * 16}px` }}
                  >
                    {category.icon ? `${category.icon} ` : ''}{category.name}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-slate-400">
                  No categories found
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
