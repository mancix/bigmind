import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';

import { ConflictIndicator } from './conflict-indicator';
import { ConflictNotifications } from './conflict-notifications';
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

function makeConflict(id: string): ConflictRecord {
  return {
    id,
    entityType: 'note',
    entityId: 'note-1',
    conflictType: 'content',
    localVersion: 1,
    remoteVersion: 2,
    localSnapshot: { version: 1, entity: {} },
    remoteSnapshot: { version: 2, entity: {} },
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
  };
}

function buildRouter(element: React.ReactNode) {
  const root = createRootRoute({
    component: () => <div>{element}</div>,
  });
  const conflictsListRoute = createRoute({
    path: '/conflicts',
    component: () => null,
    getParentRoute: () => root,
  });
  const conflictDetailRoute = createRoute({
    path: '/conflicts/$conflictId',
    component: () => null,
    getParentRoute: () => root,
  });
  const indexRoute = createRoute({
    path: '/',
    component: () => null,
    getParentRoute: () => root,
  });
  root.addChildren([indexRoute, conflictsListRoute, conflictDetailRoute]);
  return createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
}

describe('ConflictIndicator', () => {
  it('shows "No conflicts" when no open conflicts exist', async () => {
    render(<RouterProvider router={buildRouter(<ConflictIndicator />)} />);
    expect(await screen.findByText('No conflicts')).toBeDefined();
  });

  it('displays "1 conflict" and links to /conflicts when one is open', async () => {
    await db.conflicts.add(makeConflict('conflict-open'));
    render(<RouterProvider router={buildRouter(<ConflictIndicator />)} />);
    const link = await screen.findByText('1 conflict');
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toContain('/conflicts');
  });
});

describe('ConflictNotifications', () => {
  it('renders nothing by default', () => {
    render(<RouterProvider router={buildRouter(<ConflictNotifications />)} />);
    expect(screen.queryByText('Synchronization conflict detected.')).toBeNull();
  });

  it('renders a non-blocking notification with Review link on conflict creation event', async () => {
    render(<RouterProvider router={buildRouter(<ConflictNotifications />)} />);
    expect(screen.queryByText('Synchronization conflict detected.')).toBeNull();

    await conflictRepository.create({
      entityType: 'note',
      entityId: 'note-1',
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: {} },
      remoteSnapshot: { version: 2, entity: {} },
    });

    expect(await screen.findByText('Synchronization conflict detected.')).toBeDefined();
    expect(screen.getByText('Review')).toBeDefined();
    expect(screen.getByText('Review').getAttribute('href')).toContain('/conflicts/');
  });
});