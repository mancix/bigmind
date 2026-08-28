/* eslint-disable import/first */

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';

import type { SearchResult } from '../../search/search.types';

const mockSearch = vi.hoisted(() => vi.fn<(_query: string) => SearchResult[]>());

vi.mock('../../search/search-service', () => ({
  searchService: {
    initialize: vi.fn<() => Promise<void>>(),
    search: mockSearch,
    destroy: vi.fn(),
  },
}));

import { AuthProvider } from '../../auth/auth-context';
import { WorkspaceProvider } from '../../workspaces/workspace-context';
import { db, type NoteRecord } from '../../../storage/database';
import { NotesSidebar } from './notes-sidebar';

function createNote(id: string, overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id, title: 'Untitled note', content: '', categoryId: null,
    templateType: 'MARKDOWN',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1, syncStatus: 'synced', ...overrides,
  };
}

function renderSidebar() {
  const root = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({ path: '/', component: () => <NotesSidebar />, getParentRoute: () => root });
  root.addChildren([indexRoute]);
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
  return render(<AuthProvider><WorkspaceProvider><RouterProvider router={router} /></WorkspaceProvider></AuthProvider>);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  cleanup();
  await db.delete();
});

describe('NotesSidebar search', () => {
  it('renders the search input', async () => {
    renderSidebar();
    expect(await screen.findByPlaceholderText('Search notes...')).toBeDefined();
  });

  it('shows notes from current category when not searching', async () => {
    await db.notes.bulkAdd([
      createNote('1', { title: 'Note one', content: 'Alpha' }),
      createNote('2', { title: 'Note two', content: 'Beta' }),
    ]);

    renderSidebar();

    expect(await screen.findByText('Note one')).toBeDefined();
    expect(await screen.findByText('Note two')).toBeDefined();
  });

  it('shows search results when typing a query', async () => {
    mockSearch.mockReturnValue([
      { id: '1', title: 'Apple pie', score: 1, preview: 'How to bake an apple pie' },
    ]);

    await db.notes.bulkAdd([
      createNote('1', { title: 'Apple pie', content: 'How to bake' }),
    ]);

    renderSidebar();

    const input = await screen.findByPlaceholderText('Search notes...');
    await userEvent.type(input, 'Apple');

    expect(await screen.findByText('Apple')).toBeDefined();
  });

  it('shows "No notes found" when search yields no results', async () => {
    mockSearch.mockReturnValue([]);

    await db.notes.bulkAdd([
      createNote('1', { title: 'Apple pie', content: 'How to bake' }),
    ]);

    renderSidebar();

    const input = await screen.findByPlaceholderText('Search notes...');
    await userEvent.type(input, 'Zebra');

    expect(await screen.findByText('No notes found')).toBeDefined();
  });

  it('switches back to category notes when search is cleared', async () => {
    mockSearch.mockReturnValue([
      { id: '1', title: 'Apple pie', score: 1, preview: 'How to bake an apple pie' },
    ]);

    await db.notes.bulkAdd([
      createNote('1', { title: 'Apple pie', content: 'How to bake' }),
      createNote('2', { title: 'Banana bread', content: 'Easy recipe' }),
    ]);

    renderSidebar();

    const input = await screen.findByPlaceholderText('Search notes...');
    await userEvent.type(input, 'Apple');
    expect(await screen.findByText('Apple')).toBeDefined();

    await userEvent.clear(input);
    expect(await screen.findByText('Apple pie')).toBeDefined();
    expect(await screen.findByText('Banana bread')).toBeDefined();
  });

  it('links search results to the note page', async () => {
    mockSearch.mockReturnValue([
      { id: '1', title: 'Apple pie', score: 1, preview: 'How to bake an apple pie' },
    ]);

    await db.notes.bulkAdd([
      createNote('1', { title: 'Apple pie', content: 'How to bake' }),
    ]);

    renderSidebar();

    const input = await screen.findByPlaceholderText('Search notes...');
    await userEvent.type(input, 'Apple');

    const link = await screen.findByRole('link', { name: /apple/i });
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toContain('/notes/1');
  });
});
