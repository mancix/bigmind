import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';

import type { SearchResult } from '../search/search.types';
import { storage, type CategoryRecord } from '../../storage';
import { noteRepository } from '../notes/note-repository';
import { categoryRepository } from '../categories/category-repository';
import { CommandPalette } from './command-palette';

const mockSearch = vi.hoisted(() => vi.fn<(query: string) => SearchResult[]>());

vi.mock('../search/search-service', () => ({
  searchService: {
    initialize: vi.fn<() => Promise<void>>(),
    search: mockSearch,
    destroy: vi.fn(),
  },
}));

function createCategoryRecord(
  id: string,
  overrides: Partial<CategoryRecord> = {},
): CategoryRecord {
  return {
    id,
    name: 'Test category',
    description: '',
    icon: null,
    parentId: null,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    deletedAt: null,
    syncStatus: 'synced',
    ...overrides,
  };
}

const PLACEHOLDER = 'Search notes, categories, or run a command...';

function renderPalette(isOpen = true, onClose = vi.fn()) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <Outlet />
        {isOpen && <CommandPalette isOpen={true} onClose={onClose} />}
      </>
    ),
  });

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <div>Home page</div>,
  });

  const noteRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/notes/$noteId',
    component: () => <div>Note page</div>,
  });

  const conflictsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/conflicts',
    component: () => <div>Conflicts page</div>,
  });

  rootRoute.addChildren([indexRoute, noteRoute, conflictsRoute]);

  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });

  const result = render(<RouterProvider router={router} />);
  return { router, onClose, ...result };
}

beforeEach(async () => {
  mockSearch.mockReset();
  mockSearch.mockReturnValue([]);
  await storage.delete();
  await storage.open();
  vi.spyOn(noteRepository, 'create').mockResolvedValue('mock-note-id');
  vi.spyOn(categoryRepository, 'create').mockResolvedValue('mock-category-id');
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await storage.delete();
});

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    renderPalette(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows dialog and input when open', async () => {
    renderPalette(true);
    expect(await screen.findByRole('dialog')).toBeDefined();
    expect(await screen.findByPlaceholderText(PLACEHOLDER)).toBeDefined();
  });

  it('focuses the input when opened', async () => {
    renderPalette(true);
    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    expect(document.activeElement).toBe(input);
  });

  it('shows static actions when no query is entered', async () => {
    renderPalette(true);
    expect(await screen.findByText('Actions')).toBeDefined();
    expect(await screen.findByText('Open conflicts')).toBeDefined();
    expect(await screen.findByText('Go to All Notes')).toBeDefined();
    expect(await screen.findByText('Go to Uncategorized')).toBeDefined();
  });

  it('shows create actions when query is entered', async () => {
    renderPalette(true);
    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    await userEvent.type(input, 'test');
    expect(await screen.findByText('Create note')).toBeDefined();
    expect(await screen.findByText('Create category')).toBeDefined();
  });

  it('shows note search results when query matches', async () => {
    mockSearch.mockReturnValue([
      {
        id: 'n1',
        title: 'Apple pie',
        score: 1,
        preview: 'How to bake an apple pie',
      },
    ]);
    renderPalette(true);
    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    await userEvent.type(input, 'Apple');
    expect(await screen.findByText('Apple pie')).toBeDefined();
    expect(await screen.findByText('How to bake an apple pie')).toBeDefined();
  });

  it('shows matching categories when query matches', async () => {
    await storage.categories.put(
      createCategoryRecord('cat-1', { name: 'Work notes' }),
    );

    renderPalette(true);

    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    await userEvent.type(input, 'Work');

    expect(await screen.findByText('Work notes')).toBeDefined();
  });

  it('activates first action (Open conflicts) on Enter and navigates', async () => {
    const { onClose } = renderPalette(true);
    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    await userEvent.type(input, '{Enter}');
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('creates a note when Create note is selected and Enter is pressed', async () => {
    renderPalette(true);
    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    await userEvent.type(input, 'New note{Enter}');
    expect(noteRepository.create).toHaveBeenCalledWith({
      title: 'New note',
    });
  });

  it('creates a category when Create category is activated', async () => {
    renderPalette(true);
    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    await userEvent.type(input, 'New cat{ArrowDown}{Enter}');
    expect(categoryRepository.create).toHaveBeenCalledWith({
      name: 'New cat',
    });
  });

  it('closes on Escape', async () => {
    const { onClose } = renderPalette(true);
    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    await userEvent.type(input, '{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on backdrop click', async () => {
    const { onClose } = renderPalette(true);
    const dialog = await screen.findByRole('dialog');
    const backdrop = dialog.parentElement!;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('updates note search when query changes', async () => {
    mockSearch.mockImplementation((q: string) => {
      if (q === 'Al')
        return [{ id: '1', title: 'Alpha', score: 1, preview: 'First' }];
      if (q === 'Be')
        return [{ id: '2', title: 'Beta', score: 1, preview: 'Second' }];
      return [];
    });
    renderPalette(true);
    const input = await screen.findByPlaceholderText(PLACEHOLDER);
    await userEvent.type(input, 'Al');
    expect(await screen.findByText('Alpha')).toBeDefined();
    await userEvent.clear(input);
    await userEvent.type(input, 'Be');
    expect(await screen.findByText('Beta')).toBeDefined();
  });
});
