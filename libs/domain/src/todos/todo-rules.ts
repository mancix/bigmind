import type { TodoItem } from './todo.js';

export function createTodoItem(
  todoListId: string,
  text: string,
  position: number,
): Omit<TodoItem, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    todoListId,
    text,
    completed: false,
    position,
  };
}

export function toggleTodoItem(
  item: TodoItem,
): Pick<TodoItem, 'completed' | 'updatedAt'> {
  return {
    completed: !item.completed,
    updatedAt: new Date().toISOString(),
  };
}

export function reorderTodoItems(
  items: TodoItem[],
  itemId: string,
  newPosition: number,
): TodoItem[] {
  const maxIndex = items.length - 1;
  const clampedPosition = Math.max(0, Math.min(newPosition, maxIndex));

  const item = items.find((i) => i.id === itemId);
  if (!item) return items;

  const without = items.filter((i) => i.id !== itemId);
  const updated = [...without];
  updated.splice(clampedPosition, 0, {
    ...item,
    position: clampedPosition,
    updatedAt: new Date().toISOString(),
  });

  return updated.map((i, index) => ({
    ...i,
    position: index,
  }));
}
