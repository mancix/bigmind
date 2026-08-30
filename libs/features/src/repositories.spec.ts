import { describe, expect, it } from 'vitest';
import { createInMemoryStorage } from '@bigmind/storage';
import { OutboxRepository } from '@bigmind/sync';

import { CategoryRepository } from './categories/category-repository.js';
import { NoteRepository } from './notes/note-repository.js';

function createHarness() {
  const storage = createInMemoryStorage();
  const outbox = new OutboxRepository(storage);
  const notes = new NoteRepository(storage, outbox);
  const categories = new CategoryRepository(storage, outbox);
  return { storage, outbox, notes, categories };
}

describe('shared feature repositories (platform independent)', () => {
  it('creates and lists notes with outbox operations', async () => {
    const { notes, outbox } = createHarness();

    const id = await notes.create({ title: '  Hello  ', content: '**bold**' });
    const list = await notes.list();

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id,
      title: 'Hello', // normalized by the shared domain rule
      templateType: 'MARKDOWN',
      syncStatus: 'pending',
    });
    expect(await outbox.listForEntity(id, 'note')).toMatchObject([
      { entityType: 'note', operation: 'create', status: 'pending' },
    ]);
  });

  it('coalesces edits into a single outbox operation', async () => {
    const { notes, outbox } = createHarness();

    const id = await notes.create({ title: 'First' });
    await notes.update(id, { title: 'Second' });
    await notes.update(id, { content: 'Content' });

    const operations = await outbox.listForEntity(id, 'note');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      operation: 'create',
      payload: { title: 'Second', content: 'Content' },
    });
  });

  it('builds the category tree and respects delete guards', async () => {
    const { categories, notes, outbox } = createHarness();

    const root = await categories.create({ name: 'Research', icon: '🔬' });
    const child = await categories.create({ name: ' Papers ', parentId: root });

    const tree = await categories.listTree();
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: 'Research', icon: '🔬' });
    expect(tree[0].children).toMatchObject([{ name: 'Papers' }]);

    // A category with children cannot be deleted.
    await expect(categories.delete(root)).rejects.toMatchObject({
      code: 'CATEGORY_NOT_EMPTY',
    });

    // A category with notes cannot be deleted.
    const noteId = await notes.create({ title: 'Assigned', categoryId: child });
    await expect(categories.delete(child)).rejects.toMatchObject({
      code: 'CATEGORY_HAS_NOTES',
    });

    await notes.delete(noteId);
    await categories.delete(child);
    expect(await categories.list()).toHaveLength(1);

    void outbox;
  });

  it('filters notes by category', async () => {
    const { notes, categories } = createHarness();

    const cat = await categories.create({ name: 'Work' });
    await notes.create({ title: 'In category', categoryId: cat });
    await notes.create({ title: 'Uncategorized' });

    const filtered = await notes.list({ categoryId: cat });
    expect(filtered.map((note) => note.title)).toEqual(['In category']);
  });
});
