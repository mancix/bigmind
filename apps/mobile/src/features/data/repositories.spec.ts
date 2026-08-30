import { storage } from '../../storage';
import {
  categoryRepository,
  mobileOutbox,
  noteRepository,
} from './repositories';

describe('mobile note & category repositories (shared logic)', () => {
  beforeEach(async () => {
    await storage.clearAll();
  });

  afterEach(async () => {
    await storage.clearAll();
  });

  it('creates a note and lists it with a pending outbox operation', async () => {
    const id = await noteRepository.create({
      title: '  Hello mobile  ',
      content: 'First note',
    });

    const list = await noteRepository.list();
    expect(list).toEqual([
      expect.objectContaining({
        id,
        title: 'Hello mobile', // normalized by the shared domain rule
        templateType: 'MARKDOWN',
        syncStatus: 'pending',
      }),
    ]);

    const operations = await mobileOutbox.listForEntity(id, 'note');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      entityType: 'note',
      operation: 'create',
      status: 'pending',
    });
  });

  it('coalesces consecutive note edits into one outbox operation', async () => {
    const id = await noteRepository.create({ title: 'First' });
    await noteRepository.update(id, { title: 'Second' });
    await noteRepository.update(id, { content: 'Latest content' });

    const operations = await mobileOutbox.listForEntity(id, 'note');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      operation: 'create',
      payload: { title: 'Second', content: 'Latest content' },
    });
  });

  it('builds the category tree (domain rules) and filters notes by category', async () => {
    const root = await categoryRepository.create({
      name: 'Project',
      icon: '🚀',
    });
    const child = await categoryRepository.create({
      name: ' Docs ',
      parentId: root,
    });
    await noteRepository.create({ title: 'Readme', categoryId: child });

    const tree = await categoryRepository.listTree();
    expect(tree[0]).toMatchObject({
      name: 'Project',
      icon: '🚀',
      children: [{ name: 'Docs' }],
    });

    const filtered = await noteRepository.list({ categoryId: child });
    expect(filtered.map((note) => note.title)).toEqual(['Readme']);
  });

  it('enforces category delete guards from the shared repository', async () => {
    const root = await categoryRepository.create({ name: 'Root' });
    const child = await categoryRepository.create({
      name: 'Child',
      parentId: root,
    });

    await expect(categoryRepository.delete(root)).rejects.toMatchObject({
      code: 'CATEGORY_NOT_EMPTY',
    });

    const noteId = await noteRepository.create({
      title: 'Occupied',
      categoryId: child,
    });
    await expect(categoryRepository.delete(child)).rejects.toMatchObject({
      code: 'CATEGORY_HAS_NOTES',
    });

    await noteRepository.delete(noteId);
    await categoryRepository.delete(child);
    expect(await categoryRepository.list()).toHaveLength(1);
  });
});
