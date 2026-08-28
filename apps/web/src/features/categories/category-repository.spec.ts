import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';

import { NoteRepository } from '../notes/note-repository';
import { db } from '../../storage/database';
import { OutboxRepository } from '../../sync/outbox-repository';
import {
  CategoryRepository,
  CategoryRepositoryError,
} from './category-repository';

const outbox = new OutboxRepository();
const categories = new CategoryRepository(outbox);
const notes = new NoteRepository(outbox);

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('category repository', () => {
  it('creates ordered parent and child categories through the shared outbox', async () => {
    const parentId = await categories.create({ name: ' Work ', icon: ' 💼 ' });
    const childId = await categories.create({ name: 'Projects', parentId });

    expect(await categories.tree()).toMatchObject([
      { id: parentId, name: 'Work', icon: '💼', children: [{ id: childId }] },
    ]);
    expect(await outbox.countPending()).toBe(2);
  });

  it('rejects text and multiple emoji as category icons', async () => {
    await expect(categories.create({ name: 'Work', icon: 'text' }))
      .rejects.toThrow('Category icon must be a single emoji.');
    await expect(categories.create({ name: 'Work', icon: '💼🚀' }))
      .rejects.toThrow('Category icon must be a single emoji.');
  });

  it('rejects cycles', async () => {
    const parentId = await categories.create({ name: 'Parent' });
    const childId = await categories.create({ name: 'Child', parentId });

    await expect(categories.move(parentId, childId)).rejects.toMatchObject({
      code: 'CATEGORY_CYCLE',
    } satisfies Partial<CategoryRepositoryError>);
  });

  it('moves a category to another parent', async () => {
    const firstParentId = await categories.create({ name: 'First' });
    const secondParentId = await categories.create({ name: 'Second' });
    const childId = await categories.create({ name: 'Child', parentId: firstParentId });

    await categories.move(childId, secondParentId);

    expect(await categories.findById(childId)).toMatchObject({
      parentId: secondParentId,
      position: 0,
    });

    await categories.move(childId, null);
    expect(await categories.findById(childId)).toMatchObject({
      parentId: null,
      position: 2,
    });
  });

  it('blocks deletion while a category contains notes', async () => {
    const categoryId = await categories.create({ name: 'Reference' });
    await notes.create({ categoryId });

    await expect(categories.delete(categoryId)).rejects.toMatchObject({
      code: 'CATEGORY_HAS_NOTES',
    } satisfies Partial<CategoryRepositoryError>);
  });

  it('blocks deletion while a category contains a subcategory', async () => {
    const categoryId = await categories.create({ name: 'Parent' });
    await categories.create({ name: 'Child', parentId: categoryId });

    await expect(categories.delete(categoryId)).rejects.toMatchObject({
      code: 'CATEGORY_NOT_EMPTY',
    } satisfies Partial<CategoryRepositoryError>);
  });

  it('removes an unsynced category and its create operation', async () => {
    const categoryId = await categories.create({ name: 'Temporary' });
    await categories.delete(categoryId);

    expect(await db.categories.get(categoryId)).toBeUndefined();
    expect(await outbox.listForEntity(categoryId, 'category')).toEqual([]);
  });

  it('assigns and filters categorized and uncategorized notes', async () => {
    const categoryId = await categories.create({ name: 'Work' });
    const categorizedId = await notes.create({ title: 'Categorized', categoryId });
    const uncategorizedId = await notes.create({ title: 'Uncategorized' });

    expect((await notes.list({ categoryId })).map(({ id }) => id)).toEqual([
      categorizedId,
    ]);
    expect((await notes.list({ categoryId: null })).map(({ id }) => id)).toEqual([
      uncategorizedId,
    ]);
    expect(await notes.list({ categoryId, includeAllCategories: true })).toHaveLength(2);
  });

  it('coalesces local category updates into its pending create', async () => {
    const categoryId = await categories.create({ name: 'First' });
    await categories.update(categoryId, { name: 'Second', icon: '🚀' });

    expect(await outbox.listForEntity(categoryId, 'category')).toMatchObject([
      { operation: 'create', payload: { name: 'Second', icon: '🚀' } },
    ]);
  });

  it('migrates existing categories and outbox payloads with no icon', async () => {
    db.close();
    await db.delete();
    const legacy = new Dexie('bigmind');
    legacy.version(3).stores({
      notes: 'id, title, categoryId, updatedAt, deletedAt, syncStatus',
      categories:
        'id, parentId, position, updatedAt, deletedAt, syncStatus, [parentId+position]',
      outbox:
        'id, entityId, entityType, createdAt, status, nextRetryAt, [entityId+status]',
      syncState: 'key',
    });
    await legacy.open();
    const legacyCategory = {
      id: 'legacy-category',
      name: 'Legacy',
      parentId: null,
      position: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 0,
      deletedAt: null,
      syncStatus: 'pending',
    };
    await legacy.table('categories').add(legacyCategory);
    await legacy.table('outbox').add({
      id: 'legacy-operation',
      entityId: legacyCategory.id,
      entityType: 'category',
      operation: 'create',
      baseVersion: 0,
      payload: legacyCategory,
      createdAt: legacyCategory.createdAt,
      retryCount: 0,
      status: 'pending',
    });
    await legacy.table('syncState').add({ key: 'cursor', value: '42' });
    legacy.close();

    await db.open();

    expect(await db.categories.get(legacyCategory.id)).toMatchObject({ icon: null });
    expect(await db.outbox.get('legacy-operation')).toMatchObject({
      payload: { icon: null },
    });
    expect(await db.syncState.get('cursor')).toEqual({ key: 'cursor', value: '42' });
  });
});
