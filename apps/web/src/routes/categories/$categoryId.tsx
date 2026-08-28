import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, Link, notFound, useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { createNotePreview } from '@bigmind/domain/notes';
import { buildCategoryTree } from '@bigmind/domain/categories';

import { MarkdownEditor } from '../../features/notes/components/markdown-editor';
import { categoryRepository } from '../../features/categories/category-repository';
import { noteRepository } from '../../features/notes/note-repository';
import { renderMarkdown } from '../../features/categories/render-markdown';
import { Icon } from '../../components/icon';
import { db, type NoteRecord } from '../../storage/database';

export const Route = createFileRoute('/categories/$categoryId')({
  loader: async ({ params }) => {
    const category = await categoryRepository.findById(params.categoryId);
    if (!category) throw notFound();
    return { categoryId: category.id };
  },
  component: CategoryPage,
});

function CategoryPage() {
  const { categoryId } = Route.useLoaderData();
  const navigate = useNavigate();

  const category = useLiveQuery(() => categoryRepository.findById(categoryId), [categoryId]);
  const categories = useLiveQuery(() => categoryRepository.list(), []) ?? [];
  const allNotes = useLiveQuery(() => db.notes.toArray(), []) ?? [];

  const [isEditing, setIsEditing] = useState(false);
  const [editDescription, setEditDescription] = useState('');

  const subcategories = useMemo(
    () => buildCategoryTree(categories).filter((c) => c.parentId === categoryId),
    [categories, categoryId],
  );

  useEffect(() => {
    if (category) setEditDescription(category.description);
  }, [category?.description, category?.id]);

  async function handleSaveDescription() {
    if (category) {
      try {
        await categoryRepository.update(categoryId, { description: editDescription });
        setIsEditing(false);
      } catch {
        // silently handled
      }
    }
  }

  async function handleCreateFirstNote() {
    const noteId = await noteRepository.create({ categoryId });
    await navigate({ to: '/notes/$noteId', params: { noteId } });
  }

  if (!category) {
    return <p className="text-sm text-outline">Loading category...</p>;
  }

  const activeNotes: NoteRecord[] = allNotes.filter(
    (n) => !n.deletedAt && n.categoryId === categoryId,
  );

  return (
    <section className="mx-auto max-w-4xl">
      <Link
        to="/"
        search={{ category: undefined }}
        className="inline-flex items-center gap-2 text-sm font-medium text-on-surface-variant transition hover:text-primary"
      >
        <Icon name="arrow_back" className="text-[20px]" />
        All notes
      </Link>

      {/* Category header */}
      <div className="mb-6 mt-4">
        <div className="mb-3 flex items-center gap-4">
          {category.icon ? <span className="text-4xl">{category.icon}</span> : null}
          <h1 className="text-[32px] font-bold leading-10 tracking-[-0.02em] text-on-surface">
            {category.name}
          </h1>
        </div>

        {isEditing ? (
          <div className="space-y-3">
            <MarkdownEditor
              initialValue={editDescription}
              onChange={(md) => setEditDescription(md)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleSaveDescription()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition hover:opacity-90"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setEditDescription(category.description); setIsEditing(false); }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-on-surface-variant transition hover:bg-surface-high"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setIsEditing(true)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsEditing(true); } }}
            className="cursor-text rounded-lg border border-transparent px-3 py-2 transition hover:border-outline-variant hover:bg-surface-low"
          >
            {category.description ? (
              <div
                className="prose prose-sm max-w-none text-on-surface-variant prose-headings:text-on-surface prose-a:text-primary"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(category.description) }}
              />
            ) : (
              <span className="text-base italic leading-6 text-on-surface-variant/60">
                No description yet.{' '}
                <span
                  className="not-italic font-medium text-primary hover:underline cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                >
                  Add description
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      {subcategories.length > 0 && (
        <div className="mt-8">
          <h2 className="border-b border-outline-variant pb-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-on-surface-variant">
            Subcategories
          </h2>
          <ul className="mt-2 space-y-1">
            {subcategories.map((sub) => (
              <li key={sub.id}>
                <Link
                  to="/categories/$categoryId"
                  params={{ categoryId: sub.id }}
                  className="block rounded-lg px-3 py-2 text-sm text-on-surface transition hover:bg-surface-high"
                >
                  {sub.icon ? `${sub.icon} ${sub.name}` : sub.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Notes section */}
      <div className="mt-8">
        <h2 className="border-b border-outline-variant pb-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-on-surface-variant">
          Notes
        </h2>
        {activeNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="relative mb-6 size-40">
              <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary-container/5 to-surface-highest opacity-50 blur-3xl" />
              <div className="relative z-10 flex h-full items-center justify-center">
                <Icon name="note_stack" className="select-none text-7xl text-outline-variant" />
              </div>
            </div>
            <p className="mb-2 text-2xl font-semibold leading-8 tracking-[-0.01em] text-on-surface-variant/60">
              No notes in this category.
            </p>
            <p className="mb-6 max-w-sm text-sm leading-5 text-on-surface-variant">
              Capture your next big spark of inspiration. Add a note to begin
              organizing your thoughts here.
            </p>
            <button
              type="button"
              onClick={() => void handleCreateFirstNote()}
              className="flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-xs font-semibold text-white shadow-md transition-all hover:bg-primary-container hover:shadow-lg active:scale-95"
            >
              <Icon name="add" className="text-xl" />
              Create first note
            </button>
          </div>
        ) : (
          <ul className="mt-2 space-y-1">
            {activeNotes.map((note) => (
              <li key={note.id}>
                <Link
                  to="/notes/$noteId"
                  params={{ noteId: note.id }}
                  className="block rounded-lg px-3 py-2 text-sm text-on-surface transition hover:bg-surface-high"
                >
                  <div className="font-medium">{note.title}</div>
                  <div className="mt-0.5 truncate text-xs text-outline">
                    {createNotePreview(note.content, 120)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
