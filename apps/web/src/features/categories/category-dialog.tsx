import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { isCategoryIcon } from '@bigmind/domain/categories';
import type { CategoryRecord } from '../../storage';
import {
  CategoryRepositoryError,
  categoryRepository,
} from './category-repository';

const CATEGORY_EMOJIS = [
  '📁',
  '💼',
  '💻',
  '🧠',
  '📚',
  '📝',
  '🎯',
  '💡',
  '🏠',
  '❤️',
  '⭐',
  '🚀',
  '🔧',
  '🎨',
  '🎵',
  '🌱',
  '🧪',
  '🔬',
  '💰',
  '✈️',
  '🍳',
  '🏋️',
  '🎮',
  '📌',
] as const;

export type CategoryDialogAction = 'create' | 'rename' | 'move' | 'delete';

interface CategoryDialogProps {
  action: CategoryDialogAction;
  category?: CategoryRecord;
  categories: CategoryRecord[];
  parentId?: string | null;
  onClose: () => void;
}

export function CategoryDialog({
  action,
  category,
  categories,
  parentId = null,
  onClose,
}: CategoryDialogProps) {
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? '');
  const [selectedParentId, setSelectedParentId] = useState(
    action === 'create' ? (parentId ?? '') : (category?.parentId ?? ''),
  );
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const descendants = useMemo(
    () =>
      category
        ? new Set([category.id, ...collectDescendants(categories, category.id)])
        : new Set<string>(),
    [categories, category],
  );

  useEffect(() => {
    setName(category?.name ?? '');
    setIcon(category?.icon ?? '');
  }, [category?.name, category?.icon]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;
    setError('');
    setIsSubmitting(true);
    try {
      if (action === 'create') {
        await categoryRepository.create({
          name,
          icon: icon || null,
          parentId: selectedParentId || null,
        });
      } else if (action === 'rename' && category) {
        await categoryRepository.update(category.id, {
          name,
          icon: icon || null,
        });
      } else if (action === 'move' && category) {
        await categoryRepository.move(category.id, selectedParentId || null);
      } else if (action === 'delete' && category) {
        await categoryRepository.delete(category.id);
      }
      onClose();
    } catch (cause) {
      setError(
        cause instanceof CategoryRepositoryError
          ? cause.message
          : 'The category could not be saved.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleIconChange(value: string) {
    const normalized = value.trim();
    if (!normalized || isCategoryIcon(normalized)) setIcon(normalized);
  }

  const title =
    action === 'create'
      ? parentId
        ? 'New subcategory'
        : 'New category'
      : action === 'rename'
        ? 'Rename category'
        : action === 'move'
          ? 'Move category'
          : 'Delete category';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4"
      role="presentation"
      onMouseDown={onClose}
    >
      <form
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-dialog-title"
        onSubmit={(event) => void handleSubmit(event)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="category-dialog-title" className="font-semibold text-slate-900">
          {title}
        </h2>
        {action === 'delete' ? (
          <p className="mt-3 text-sm text-slate-600">
            Delete “{category?.name}”? Categories containing notes or
            subcategories cannot be deleted.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {action !== 'move' && (
              <>
                <label className="block text-sm font-medium text-slate-700">
                  Category name
                  <input
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
                  />
                </label>
                <fieldset>
                  <legend className="text-sm font-medium text-slate-700">
                    Icon
                  </legend>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={icon}
                      onChange={(event) => handleIconChange(event.target.value)}
                      maxLength={32}
                      aria-label="Category icon"
                      placeholder="🙂"
                      title="Enter one emoji"
                      className="size-11 rounded-md border border-slate-300 text-center text-2xl outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setIcon('')}
                      className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                    >
                      No icon
                    </button>
                    <span className="text-xs text-slate-400">
                      Use your device emoji keyboard.
                    </span>
                  </div>
                  <div
                    className="mt-3 grid grid-cols-8 gap-1"
                    aria-label="Suggested icons"
                  >
                    {CATEGORY_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setIcon(emoji)}
                        aria-label={`Use ${emoji} icon`}
                        aria-pressed={icon === emoji}
                        className={`flex size-9 items-center justify-center rounded-md text-xl hover:bg-slate-100 ${icon === emoji ? 'bg-blue-50 ring-1 ring-blue-300' : ''}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </>
            )}
            {(action === 'create' || action === 'move') && (
              <label className="block text-sm font-medium text-slate-700">
                Parent category
                <select
                  value={selectedParentId}
                  onChange={(event) => setSelectedParentId(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="">No parent</option>
                  {categories
                    .filter(({ id }) => !descendants.has(id))
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {categoryLabel(candidate)}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
        )}
        {error && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className={`rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50 ${action === 'delete' ? 'bg-red-600' : 'bg-blue-600'}`}
          >
            {isSubmitting ? 'Saving…' : title}
          </button>
        </div>
      </form>
    </div>
  );
}

function categoryLabel(
  category: Pick<CategoryRecord, 'icon' | 'name'>,
): string {
  return category.icon ? `${category.icon} ${category.name}` : category.name;
}

function collectDescendants(
  categories: CategoryRecord[],
  id: string,
): string[] {
  const children = categories.filter(({ parentId }) => parentId === id);
  return children.flatMap((child) => [
    child.id,
    ...collectDescendants(categories, child.id),
  ]);
}
