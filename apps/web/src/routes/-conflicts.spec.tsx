import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';

import { Route as ConflictsRoute } from './conflicts';
import { conflictRepository } from '../features/conflicts/conflict-repository';
import { db, type ConflictRecord } from '../storage/database';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  cleanup();
  await db.delete();
});

function makeConflict(id: string, overrides: Partial<ConflictRecord> = {}): ConflictRecord {
  return {
    id,
    entityType: 'note',
    entityId: `note-${id}`,
    conflictType: 'content',
    localVersion: 1,
    remoteVersion: 2,
    localSnapshot: { version: 1, entity: { title: `Note ${id}` } },
    remoteSnapshot: { version: 2, entity: { title: 'Remote' } },
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
    ...overrides,
  };
}

function buildRouter() {
  const root = createRootRoute({ component: () => <Outlet /> });
  const conflictsRoute = ConflictsRoute.update({
    path: '/conflicts',
    getParentRoute: () => root,
  } as never);
  const conflictDetailRoute = createRoute({
    path: '/conflicts/$conflictId',
    component: () => null,
    getParentRoute: () => root,
  });
  root.addChildren([conflictsRoute, conflictDetailRoute]);
  return createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/conflicts'] }),
  });
}

describe('ConflictsPage', () => {
  it('shows "No conflicts" when nothing is in the conflict table', async () => {
    render(<RouterProvider router={buildRouter()} />);
    expect(await screen.findByText('Conflicts')).toBeDefined();
    expect(await screen.findByText('No conflicts')).toBeDefined();
    expect(screen.queryByText('Resolve')).toBeNull();
  });

  it('renders open conflicts first with a Resolve link and treats resolved separately', async () => {
    await db.conflicts.bulkAdd([
      makeConflict('open-1', { conflictType: 'delete_vs_edit', status: 'open' }),
      makeConflict('open-2', { status: 'open' }),
      makeConflict('resolved-1', {
        status: 'resolved',
        resolvedAt: '2026-01-02T00:00:00.000Z',
        resolution: 'keep_mine',
      }),
      makeConflict('dismissed-1', {
        status: 'dismissed',
        resolvedAt: '2026-01-02T00:00:00.000Z',
        resolution: 'dismiss',
      }),
    ]);
    render(<RouterProvider router={buildRouter()} />);

    // open conflicts appear first with a Resolve link each
    const resolveButtons = await screen.findAllByText('Resolve');
    expect(resolveButtons).toHaveLength(2);
    // resolved and dismissed cards render as "Review"
    const reviewButtons = await screen.findAllByText('Review');
    expect(reviewButtons).toHaveLength(2);
  });

  it('filters open conflicts via the repository helpers', async () => {
    await db.conflicts.bulkAdd([
      makeConflict('a-1', { status: 'open' }),
      makeConflict('a-2', { status: 'resolved', resolvedAt: '2026-01-01T00:00:00.000Z' }),
      makeConflict('a-3', { status: 'dismissed', resolvedAt: '2026-01-01T00:00:00.000Z' }),
    ]);

    const open = await conflictRepository.listOpen();
    const resolved = await conflictRepository.listResolved();
    const dismissed = await conflictRepository.listDismissed();
    const count = await conflictRepository.countOpen();

    expect(open.map((c) => c.id)).toEqual(['a-1']);
    expect(resolved.map((c) => c.id).sort()).toEqual(['a-2', 'a-3']);
    expect(dismissed.map((c) => c.id)).toEqual(['a-3']);
    expect(count).toBe(1);
  });
});