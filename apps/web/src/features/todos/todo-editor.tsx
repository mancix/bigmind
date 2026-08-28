import { useCallback, useEffect, useRef, useState } from 'react';

import type { TodoItemRecord } from '../../storage/database';
import { Icon } from '../../components/icon';
import { todoRepository } from './todo-repository';

export interface TodoEditorProps {
  noteId: string;
}

const HIDE_COMPLETED_KEY = 'bigmind_todo_hide_completed';

export function TodoEditor({ noteId }: TodoEditorProps) {
  const [items, setItems] = useState<TodoItemRecord[]>([]);
  const [newText, setNewText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [hideCompleted, setHideCompleted] = useState(() => {
    return localStorage.getItem(HIDE_COMPLETED_KEY) === 'true';
  });
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const visibleItems = items.filter((item) => !hideCompleted || !item.completed);

  const setItemRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) itemRefs.current.set(id, el);
    else itemRefs.current.delete(id);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await todoRepository.listByNoteId(noteId);
      setItems(data);
      setError('');
    } catch {
      setError('Failed to load todo items');
    } finally {
      setIsLoading(false);
    }
  }, [noteId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newText.trim();
    if (!trimmed) return;
    try {
      const item = await todoRepository.create(noteId, trimmed);
      setItems((prev) => [...prev, item]);
      setNewText('');
      setError('');
      inputRef.current?.focus();
    } catch {
      setError('Failed to add item');
    }
  }

  function startEdit(item: TodoItemRecord) {
    setEditingId(item.id);
    setEditText(item.text);
  }

  async function handleEditSubmit(itemId: string) {
    const trimmed = editText.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }
    try {
      const updated = await todoRepository.update(itemId, trimmed);
      setItems((prev) => prev.map((i) => (i.id === itemId ? updated : i)));
      setEditingId(null);
    } catch {
      setError('Failed to update item');
    }
  }

  async function handleEditKeyDown(e: React.KeyboardEvent, itemId: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      await handleEditSubmit(itemId);
      const idx = visibleItems.findIndex((i) => i.id === itemId);
      const nextItem = idx >= 0 && idx < visibleItems.length - 1 ? visibleItems[idx + 1] : null;
      if (nextItem) {
        startEdit(nextItem);
      } else {
        inputRef.current?.focus();
      }
    } else if (e.key === 'Backspace' && editText === '') {
      e.preventDefault();
      const idx = visibleItems.findIndex((i) => i.id === itemId);
      const prevItem = idx > 0 ? visibleItems[idx - 1] : null;
      await handleDelete(itemId);
      if (prevItem) {
        startEdit(prevItem);
      } else {
        inputRef.current?.focus();
      }
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  }

  async function handleToggle(itemId: string) {
    try {
      const updated = await todoRepository.toggle(itemId);
      setItems((prev) => prev.map((i) => (i.id === itemId ? updated : i)));
      setError('');
    } catch {
      setError('Failed to toggle item');
    }
  }

  async function handleDelete(itemId: string) {
    try {
      await todoRepository.remove(itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      setEditingId(null);
      setError('');
    } catch {
      setError('Failed to delete item');
    }
  }

  async function handleDragEnd() {
    setDragIndex(null);
  }

  async function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      return;
    }
    await doReorder(visibleItems[dragIndex].id, targetIndex);
  }

  async function doReorder(itemId: string, targetIndex: number) {
    try {
      const reordered = await todoRepository.reorder(noteId, itemId, targetIndex);
      setItems(reordered);
      setError('');
    } catch {
      setError('Failed to reorder items');
    } finally {
      setDragIndex(null);
    }
  }

  const remaining = items.filter((i) => !i.completed).length;
  const completed = items.filter((i) => i.completed).length;

  if (isLoading) {
    return <p className="text-sm text-outline">Loading todo list...</p>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Add a todo item..."
          aria-label="New todo item"
          className="min-w-0 flex-1 rounded-xl border border-outline-variant bg-surface-lowest px-3 py-2 text-sm text-on-surface outline-none transition focus:border-primary"
        />
        <button
          type="submit"
          disabled={!newText.trim()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition hover:opacity-90 active:scale-95 disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {items.length === 0 && !isLoading && (
        <p className="py-8 text-center text-sm text-outline">
          No todo items yet. Add one above.
        </p>
      )}

      {completed > 0 && (
        <button
          type="button"
          aria-label="Show Completed"
          onClick={() => {
            const next = !hideCompleted;
            setHideCompleted(next);
            localStorage.setItem(HIDE_COMPLETED_KEY, String(next));
          }}
          className="flex items-center gap-1 text-xs font-medium text-on-surface-variant transition hover:text-primary"
        >
          <Icon
            name="expand_more"
            className={`text-[18px] transition-transform ${hideCompleted ? '' : 'rotate-180'}`}
          />
          Show Completed ({completed})
        </button>
      )}

      <ul className="space-y-2" role="list" aria-label="Todo items">
        {visibleItems.map((item, index) => (
          <li
            key={item.id}
            role="listitem"
            draggable={editingId !== item.id}
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); void handleDrop(index); }}
            onDragEnd={handleDragEnd}
            className={`group flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-lowest px-4 py-3 shadow-sm transition hover:border-primary ${
              dragIndex === index ? 'opacity-50' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => void handleToggle(item.id)}
              aria-label={item.completed ? 'Mark incomplete' : 'Mark complete'}
              className={`flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition ${
                item.completed
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-outline-variant hover:border-primary'
              }`}
            >
              {item.completed && (
                <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>

            <div ref={(el) => setItemRef(item.id, el)} className="min-w-0 flex-1">
              {editingId === item.id ? (
                <input
                  ref={editInputRef}
                  type="text"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={() => void handleEditSubmit(item.id)}
                  onKeyDown={(e) => handleEditKeyDown(e, item.id)}
                  aria-label="Edit todo item"
                  className="w-full rounded border border-primary px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
                />
              ) : (
                <span
                  data-edit-text
                  role="button"
                  tabIndex={0}
                  aria-label={`Edit "${item.text}"`}
                  className={`block cursor-text text-sm outline-none transition-colors focus:rounded focus:ring-2 focus:ring-primary group-hover:text-primary ${
                    item.completed
                      ? 'text-on-surface-variant line-through'
                      : 'text-on-surface'
                  }`}
                  onClick={() => startEdit(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      startEdit(item);
                    }
                  }}
                >
                  {item.text}
                </span>
              )}
            </div>

            <span className="hidden cursor-grab text-outline-variant hover:text-outline active:cursor-grabbing md:inline" aria-hidden="true">
              <Icon name="drag_indicator" className="text-[18px]" />
            </span>

            <span className="flex shrink-0 flex-col leading-none opacity-0 group-hover:opacity-100 md:hidden">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => void doReorder(item.id, index - 1)}
                aria-label="Move up"
                className={`text-xs leading-none ${index === 0 ? 'text-outline-variant' : 'text-outline hover:text-on-surface'}`}
              >
                ▲
              </button>
              <button
                type="button"
                disabled={index === visibleItems.length - 1}
                onClick={() => void doReorder(item.id, index + 1)}
                aria-label="Move down"
                className={`text-xs leading-none ${index === visibleItems.length - 1 ? 'text-outline-variant' : 'text-outline hover:text-on-surface'}`}
              >
                ▼
              </button>
            </span>

            <button
              type="button"
              onClick={() => void handleDelete(item.id)}
              aria-label={`Delete "${item.text}"`}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-outline opacity-0 transition hover:bg-surface-high hover:text-error group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Icon name="close" className="text-[18px]" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-4 text-xs text-on-surface-variant" aria-live="polite">
        <span>Remaining: {remaining}</span>
        <span>Completed: {completed}</span>
      </div>
    </div>
  );
}
