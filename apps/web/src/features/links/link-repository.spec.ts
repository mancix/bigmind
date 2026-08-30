import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NoteRepository } from '../notes/note-repository';
import { storage } from '../../storage';
import { OutboxRepository } from '../../sync/outbox-repository';
import { LinkRepository } from './link-repository';

const outbox = new OutboxRepository(storage);
const links = new LinkRepository(storage, outbox);
const notes = new NoteRepository(storage, outbox, links);

beforeEach(async () => {
  await storage.delete();
  await storage.open();
});

afterEach(async () => {
  await storage.delete();
});

describe('link repository', () => {
  it('builds outgoing links and backlinks completely offline', async () => {
    const rustId = await notes.create({ title: 'Rust' });
    const ownershipId = await notes.create({
      title: 'Ownership',
      content: 'Read [[Rust]] and [[Rust|the book]].',
    });

    expect(
      (await links.getOutgoingLinks(ownershipId)).map(({ id }) => id),
    ).toEqual([rustId]);
    expect((await links.getBacklinks(rustId)).map(({ id }) => id)).toEqual([
      ownershipId,
    ]);
    expect(
      (await outbox.listPending()).some(
        ({ entityType }) => entityType === 'link',
      ),
    ).toBe(true);
  });

  it('keeps unresolved links local and resolves them when a note is created', async () => {
    const sourceId = await notes.create({
      title: 'Borrow Checker',
      content: 'See [[Lifetime]].',
    });

    expect(await links.getUnresolvedLinks(sourceId)).toMatchObject([
      { targetTitle: 'Lifetime', targetNoteId: null, syncStatus: 'local' },
    ]);

    const lifetimeId = await notes.create({ title: 'Lifetime' });

    expect(await links.getUnresolvedLinks(sourceId)).toEqual([]);
    expect(
      (await links.getOutgoingLinks(sourceId)).map(({ id }) => id),
    ).toEqual([lifetimeId]);
  });

  it('preserves links through rename and searches old aliases', async () => {
    const rustId = await notes.create({ title: 'Rust' });
    const sourceId = await notes.create({
      title: 'Ownership',
      content: '[[Rust]]',
    });

    await notes.update(rustId, { title: 'Rust Programming' });

    expect((await links.getOutgoingLinks(sourceId))[0]).toMatchObject({
      id: rustId,
      title: 'Rust Programming',
    });
    expect(await links.aliasesForNote(rustId)).toMatchObject([
      { alias: 'Rust' },
    ]);
    expect((await notes.search('rust')).map(({ id }) => id)).toContain(rustId);
  });

  it('updates links after content edits and removes them with deleted notes', async () => {
    const targetId = await notes.create({ title: 'Rust' });
    const sourceId = await notes.create({
      title: 'Ownership',
      content: '[[Rust]]',
    });

    await notes.update(sourceId, { content: 'No wiki links.' });
    expect(await links.getOutgoingLinks(sourceId)).toEqual([]);
    expect(await links.getBacklinks(targetId)).toEqual([]);

    await notes.update(sourceId, { content: '[[Rust]]' });
    await notes.delete(targetId);
    expect(await links.getOutgoingLinks(sourceId)).toEqual([]);
    expect(await links.getBacklinks(targetId)).toEqual([]);
  });
});
