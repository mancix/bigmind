import { describe, expect, it } from 'vitest';

import type { Conflict } from './conflict.js';
import {
  isActiveConflict,
  isConflictDismissed,
  isConflictOpen,
  isConflictResolved,
  isConflictResolvedOrDismissed,
} from './conflict-rules.js';

const baseConflict: Conflict = {
  id: 'conflict-1',
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

describe('conflict rules', () => {
  it('recognizes an open conflict as active and not resolved', () => {
    const conflict: Conflict = { ...baseConflict, status: 'open' };

    expect(isConflictOpen(conflict)).toBe(true);
    expect(isConflictResolved(conflict)).toBe(false);
    expect(isConflictDismissed(conflict)).toBe(false);
    expect(isConflictResolvedOrDismissed(conflict)).toBe(false);
    expect(isActiveConflict(conflict)).toBe(true);
  });

  it('recognizes a resolved conflict as closed', () => {
    const conflict: Conflict = {
      ...baseConflict,
      status: 'resolved',
      resolvedAt: '2026-01-02T00:00:00.000Z',
    };

    expect(isConflictResolved(conflict)).toBe(true);
    expect(isConflictOpen(conflict)).toBe(false);
    expect(isActiveConflict(conflict)).toBe(false);
    expect(isConflictResolvedOrDismissed(conflict)).toBe(true);
  });

  it('treats dismissed conflicts as closed but still queryable', () => {
    const conflict: Conflict = {
      ...baseConflict,
      status: 'dismissed',
      resolvedAt: '2026-01-02T00:00:00.000Z',
    };

    expect(isConflictDismissed(conflict)).toBe(true);
    expect(isConflictOpen(conflict)).toBe(false);
    expect(isConflictResolved(conflict)).toBe(false);
    expect(isConflictResolvedOrDismissed(conflict)).toBe(true);
    expect(isActiveConflict(conflict)).toBe(false);
  });
});