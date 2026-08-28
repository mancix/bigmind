import { describe, expect, it } from 'vitest';

import { ConflictService } from './conflict-service';
import type {
  CategoryRecord,
  NoteLinkRecord,
  NoteRecord,
} from '../../storage/database';
import type { RemoteChange } from '../../sync/sync.types';

const service = new ConflictService();

const note: NoteRecord = {
  id: 'note-1',
  title: 'Original',
  content: 'Original content',
  categoryId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  syncStatus: 'synced',
};

const category: CategoryRecord = {
  id: 'category-1',
  name: 'Root',
  icon: null,
  parentId: null,
  position: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  deletedAt: null,
  syncStatus: 'synced',
};

function remoteChange<TEntity>(
  entityType: 'note' | 'category' | 'link',
  payload: TEntity,
  version: number,
  operation: 'create' | 'update' | 'delete' = 'update',
): RemoteChange {
  return {
    entityId: 'e-1',
    entityType,
    operation,
    version,
    payload,
    changedAt: '2026-01-01T00:01:00.000Z',
  };
}

describe('ConflictService.determineConflictType', () => {
  it('classifies a note content change as content', () => {
    const type = service.determineConflictType(
      'note',
      note,
      remoteChange('note', { ...note, content: 'A different text' }, 2),
    );
    expect(type).toBe('content');
  });

  it('classifies a note title-only change as rename', () => {
    const type = service.determineConflictType(
      'note',
      note,
      remoteChange('note', { ...note, title: 'Renamed' }, 2),
    );
    expect(type).toBe('rename');
  });

  it('classifies a category parent change as category_move', () => {
    const type = service.determineConflictType(
      'category',
      category,
      remoteChange('category', { ...category, parentId: 'other' }, 2),
    );
    expect(type).toBe('category_move');
  });

  it('classifies a delete as delete_vs_edit when local entity still exists', () => {
    const type = service.determineConflictType(
      'note',
      note,
      remoteChange('note', note, 2, 'delete'),
    );
    expect(type).toBe('delete_vs_edit');
  });

  it('falls back to generic for link conflicts', () => {
    const link: NoteLinkRecord = {
      id: 'link-1',
      sourceNoteId: 'note-1',
      targetNoteId: 'note-2',
      targetTitle: 'Note 2',
      createdAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      version: 1,
      syncStatus: 'synced',
    };
    const type = service.determineConflictType(
      'link',
      link,
      remoteChange('link', link, 2),
    );
    expect(type).toBe('generic');
  });
});

describe('ConflictService.buildSnapshots', () => {
  it('captures localVersion from the local entity and remoteVersion from the change', () => {
    const built = service.buildSnapshots({
      entityType: 'note',
      entityId: note.id,
      localEntity: note,
      remoteChange: remoteChange('note', { ...note, content: 'Remote text' }, 3),
      baseVersion: 1,
    });

    expect(built).toMatchObject({
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 3,
      baseVersion: 1,
      localSnapshot: { version: 1, entity: { title: 'Original' } },
      remoteSnapshot: { version: 3, operation: 'update' },
    });
  });

  it('falls back to baseVersion when the local entity is missing its version', () => {
    const built = service.buildSnapshots({
      entityType: 'note',
      entityId: note.id,
      localEntity: { ...note, version: undefined as unknown as number },
      remoteChange: remoteChange('note', note, 5),
      baseVersion: 2,
    });

    expect(built.localVersion).toBe(2);
    expect(built.baseVersion).toBe(2);
  });
});

describe('ConflictService.canAutoResolve', () => {
  it('returns true when local and remote snapshots are deeply equal', () => {
    const entity = { ...note, content: 'Same' };
    const conflict = {
      conflictType: 'content' as const,
      localSnapshot: { version: 1, entity },
      remoteSnapshot: { version: 1, entity },
    };
    expect(service.canAutoResolve(conflict)).toBe(true);
  });

  it('returns false when local and remote snapshots differ', () => {
    const local = { ...note, content: 'Local' };
    const remote = { ...note, content: 'Remote' };
    const conflict = {
      conflictType: 'content' as const,
      localSnapshot: { version: 1, entity: local },
      remoteSnapshot: { version: 2, entity: remote },
    };
    expect(service.canAutoResolve(conflict)).toBe(false);
  });

  it('returns false for delete_vs_edit conflicts regardless of snapshots', () => {
    const conflict = {
      conflictType: 'delete_vs_edit' as const,
      localSnapshot: { version: 1, entity: note },
      remoteSnapshot: { version: 1, entity: note },
    };
    expect(service.canAutoResolve(conflict)).toBe(false);
  });
});