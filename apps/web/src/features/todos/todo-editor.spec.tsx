// @vitest-environment jsdom

/* eslint-disable import/first */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockItems = [
  { id: '1', todoListId: 'list-1', text: 'Milk', completed: false, position: 0, createdAt: '', updatedAt: '', deletedAt: null, version: 0, syncStatus: 'synced' as const },
  { id: '2', todoListId: 'list-1', text: 'Bread', completed: false, position: 1, createdAt: '', updatedAt: '', deletedAt: null, version: 0, syncStatus: 'synced' as const },
  { id: '3', todoListId: 'list-1', text: 'Eggs', completed: true, position: 2, createdAt: '', updatedAt: '', deletedAt: null, version: 0, syncStatus: 'synced' as const },
];

const mockRepo = vi.hoisted(() => ({
  listByNoteId: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  toggle: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('./todo-repository', () => ({
  todoRepository: mockRepo,
}));

import { TodoEditor } from './todo-editor';

beforeEach(() => {
  localStorage.clear();
  mockRepo.listByNoteId.mockResolvedValue(mockItems);
  mockRepo.create.mockResolvedValue({
    id: '4', todoListId: 'list-1', text: 'New item', completed: false, position: 3,
    createdAt: '', updatedAt: '', deletedAt: null, version: 0, syncStatus: 'pending',
  });
  mockRepo.update.mockImplementation(async (_id: string, text: string) => ({
    ...mockItems[0], text,
  }));
  mockRepo.toggle.mockImplementation(async (id: string) => {
    const item = mockItems.find((i) => i.id === id)!;
    return { ...item, completed: !item.completed };
  });
  mockRepo.remove.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('TodoEditor', () => {
  it('renders todo items from repository', async () => {
    render(<TodoEditor noteId="note-1" />);

    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeDefined();
      expect(screen.getByText('Bread')).toBeDefined();
      expect(screen.getByText('Eggs')).toBeDefined();
    });
  });

  it('shows remaining and completed counts', async () => {
    render(<TodoEditor noteId="note-1" />);

    await waitFor(() => {
      expect(screen.getByText('Remaining: 2')).toBeDefined();
      expect(screen.getByText('Completed: 1')).toBeDefined();
    });
  });

  it('adds a new item via repository', async () => {
    render(<TodoEditor noteId="note-1" />);

    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeDefined();
    });

    const input = screen.getByPlaceholderText('Add a todo item...');
    fireEvent.change(input, { target: { value: 'New item' } });
    fireEvent.click(screen.getByText('Add'));

    await waitFor(() => {
      expect(mockRepo.create).toHaveBeenCalledWith('note-1', 'New item');
    });
  });

  it('toggles completion via repository', async () => {
    render(<TodoEditor noteId="note-1" />);

    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeDefined();
    });

    const toggleButtons = screen.getAllByRole('button', { name: /mark (complete|incomplete)/i });
    fireEvent.click(toggleButtons[0]);

    await waitFor(() => {
      expect(mockRepo.toggle).toHaveBeenCalledWith('1');
    });
  });

  it('deletes via repository', async () => {
    render(<TodoEditor noteId="note-1" />);

    await waitFor(() => {
      expect(screen.getByText('Milk')).toBeDefined();
    });

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(mockRepo.remove).toHaveBeenCalledWith('1');
    });
  });

  it('shows loading state initially', () => {
    mockRepo.listByNoteId.mockImplementation(() => new Promise(() => undefined));

    render(<TodoEditor noteId="note-1" />);

    expect(screen.getByText('Loading todo list...')).toBeDefined();
  });

  it('shows empty state when no items', async () => {
    mockRepo.listByNoteId.mockResolvedValue([]);

    render(<TodoEditor noteId="note-1" />);

    await waitFor(() => {
      expect(screen.getByText(/No todo items yet/)).toBeDefined();
    });
  });

  describe('show completed toggle', () => {
    it('shows the toggle when there are completed items', async () => {
      render(<TodoEditor noteId="note-1" />);

      await waitFor(() => {
        expect(screen.getByLabelText('Show Completed')).toBeDefined();
      });
    });

    it('hides completed items when unchecked', async () => {
      render(<TodoEditor noteId="note-1" />);

      await waitFor(() => {
        expect(screen.getByText('Eggs')).toBeDefined();
      });

      const toggle = screen.getByLabelText('Show Completed');
      fireEvent.click(toggle);

      await waitFor(() => {
        expect(screen.queryByText('Eggs')).toBeNull();
      });

      expect(screen.getByText('Milk')).toBeDefined();
      expect(screen.getByText('Bread')).toBeDefined();
    });

    it('shows completed items again when re-checked', async () => {
      render(<TodoEditor noteId="note-1" />);

      await waitFor(() => {
        expect(screen.getByText('Eggs')).toBeDefined();
      });

      const toggle = screen.getByLabelText('Show Completed');
      fireEvent.click(toggle);

      await waitFor(() => {
        expect(screen.queryByText('Eggs')).toBeNull();
      });

      fireEvent.click(toggle);

      await waitFor(() => {
        expect(screen.getByText('Eggs')).toBeDefined();
      });
    });

    it('keeps counters correct when items are hidden', async () => {
      render(<TodoEditor noteId="note-1" />);

      await waitFor(() => {
        expect(screen.getByText('Completed: 1')).toBeDefined();
      });

      const toggle = screen.getByLabelText('Show Completed');
      fireEvent.click(toggle);

      await waitFor(() => {
        expect(screen.getByText('Completed: 1')).toBeDefined();
        expect(screen.getByText('Remaining: 2')).toBeDefined();
      });
    });

    it('persists hide preference to localStorage', async () => {
      render(<TodoEditor noteId="note-1" />);

      await waitFor(() => {
        expect(screen.getByText('Eggs')).toBeDefined();
      });

      const toggle = screen.getByLabelText('Show Completed');
      fireEvent.click(toggle);

      await waitFor(() => {
        expect(localStorage.getItem('bigmind_todo_hide_completed')).toBe('true');
      });
    });
  });
});
