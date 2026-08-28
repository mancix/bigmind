// @vitest-environment jsdom

/* eslint-disable import/first */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mockList = vi.hoisted(() => vi.fn());
const mockToggle = vi.hoisted(() => vi.fn());
const mockRemove = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('../features/reminders/reminders-repository', () => ({
  remindersRepository: {
    list: mockList,
    toggle: mockToggle,
    remove: mockRemove,
    create: mockCreate,
  },
}));

import { AgendaPage } from './agenda';

const base = {
  workspaceId: 'ws-1',
  description: '',
  createdBy: 'user-1',
  linkedNoteId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  syncStatus: 'synced' as const,
};

function mk(over: Partial<typeof base & { id: string; title: string; dueAt: string; completed: boolean }>) {
  return { ...base, ...over };
}

beforeEach(() => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  mockList.mockResolvedValue([
    mk({ id: '1', title: 'Grocery', dueAt: today.toISOString(), completed: false }),
    mk({ id: '2', title: 'Meeting', dueAt: tomorrow.toISOString(), completed: false }),
    mk({ id: '3', title: 'Review', dueAt: nextWeek.toISOString(), completed: false }),
    mk({ id: '4', title: 'Done task', dueAt: today.toISOString(), completed: true }),
  ]);
  mockToggle.mockResolvedValue(undefined);
  mockRemove.mockResolvedValue(undefined);
  mockCreate.mockResolvedValue('new-id');
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('AgendaPage', () => {
  it('groups reminders by Today, Tomorrow, Upcoming, Completed', async () => {
    render(<AgendaPage />);
    await waitFor(() => {
      expect(screen.getByText('Grocery')).toBeDefined();
      expect(screen.getByText('Meeting')).toBeDefined();
      expect(screen.getByText('Review')).toBeDefined();
      expect(screen.getByText('Done task')).toBeDefined();
    });
    expect(screen.getByText(/Today/)).toBeDefined();
    expect(screen.getByText(/Tomorrow/)).toBeDefined();
    expect(screen.getByText(/Upcoming/)).toBeDefined();
    expect(screen.getByText(/Completed/)).toBeDefined();
  });

  it('toggles completion', async () => {
    render(<AgendaPage />);
    await waitFor(() => expect(screen.getByText('Grocery')).toBeDefined());
    const toggleButtons = screen.getAllByRole('button', { name: /mark/i });
    toggleButtons[0].click();
    await waitFor(() => expect(mockToggle).toHaveBeenCalledWith('1'));
  });

  it('deletes a reminder', async () => {
    render(<AgendaPage />);
    await waitFor(() => expect(screen.getByText('Grocery')).toBeDefined());
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    deleteButtons[0].click();
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('1'));
  });

  it('shows empty state', async () => {
    mockList.mockResolvedValue([]);
    render(<AgendaPage />);
    await waitFor(() => expect(screen.getByText(/No reminders yet/)).toBeDefined());
  });
});
