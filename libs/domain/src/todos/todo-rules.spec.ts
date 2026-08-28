import { describe, expect, it } from 'vitest';

import { createTodoItem, reorderTodoItems, toggleTodoItem } from './todo-rules.js';
import type { TodoItem } from './todo.js';

const baseItem: TodoItem = {
  id: 'item-1',
  todoListId: 'list-1',
  text: 'Buy milk',
  completed: false,
  position: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeItem(overrides: Partial<TodoItem> = {}): TodoItem {
  return { ...baseItem, ...overrides };
}

describe('createTodoItem', () => {
  it('creates an incomplete item at the given position', () => {
    const item = createTodoItem('list-1', 'Write tests', 2);
    expect(item.todoListId).toBe('list-1');
    expect(item.text).toBe('Write tests');
    expect(item.completed).toBe(false);
    expect(item.position).toBe(2);
  });
});

describe('toggleTodoItem', () => {
  it('toggles completed from false to true', () => {
    const result = toggleTodoItem(makeItem({ completed: false }));
    expect(result.completed).toBe(true);
  });

  it('toggles completed from true to false', () => {
    const result = toggleTodoItem(makeItem({ completed: true }));
    expect(result.completed).toBe(false);
  });
});

describe('reorderTodoItems', () => {
  it('reorders items and updates positions', () => {
    const items = [
      makeItem({ id: 'a', position: 0 }),
      makeItem({ id: 'b', position: 1 }),
      makeItem({ id: 'c', position: 2 }),
    ];

    const result = reorderTodoItems(items, 'c', 0);

    expect(result[0].id).toBe('c');
    expect(result[1].id).toBe('a');
    expect(result[2].id).toBe('b');
    expect(result[0].position).toBe(0);
    expect(result[1].position).toBe(1);
    expect(result[2].position).toBe(2);
  });

  it('clamps position to valid range', () => {
    const items = [
      makeItem({ id: 'a', position: 0 }),
      makeItem({ id: 'b', position: 1 }),
    ];

    const negResult = reorderTodoItems(items, 'b', -1);
    expect(negResult[0].id).toBe('b');

    const overResult = reorderTodoItems(items, 'a', 99);
    expect(overResult[1].id).toBe('a');
  });

  it('returns unchanged items when the item is not found', () => {
    const items = [makeItem({ id: 'a', position: 0 })];
    expect(reorderTodoItems(items, 'nonexistent', 0)).toEqual(items);
  });
});
