import {
  extractWikiLinks,
  normalizeWikiLinkName,
  resolveWikiLinkTarget,
} from '@bigmind/domain/links';

import {
  db,
  type NoteAliasRecord,
  type NoteLinkRecord,
  type NoteRecord,
  type OutboxRecord,
} from '../../storage/database';
import {
  OutboxRepository,
  outboxRepository,
} from '../../sync/outbox-repository';

export class LinkRepository {
  constructor(private readonly outbox: OutboxRepository = outboxRepository) {}

  async rebuildForNote(note: NoteRecord): Promise<void> {
    await this.outbox.transactionWithNoteGraph(() => this.rebuild(note));
  }

  async getOutgoingLinks(noteId: string): Promise<NoteRecord[]> {
    const links = await db.noteLinks
      .where('sourceNoteId')
      .equals(noteId)
      .filter((link) => Boolean(link.targetNoteId) && !link.deletedAt)
      .toArray();
    return this.activeNotes(links.map((link) => link.targetNoteId));
  }

  async getBacklinks(noteId: string): Promise<NoteRecord[]> {
    const links = await db.noteLinks
      .where('targetNoteId')
      .equals(noteId)
      .filter((link) => !link.deletedAt)
      .toArray();
    return this.activeNotes(links.map((link) => link.sourceNoteId));
  }

  async getUnresolvedLinks(noteId: string): Promise<NoteLinkRecord[]> {
    return db.noteLinks
      .where('sourceNoteId')
      .equals(noteId)
      .filter((link) => link.targetNoteId === null && !link.deletedAt)
      .toArray();
  }

  async deleteLinksForNote(noteId: string, timestamp = new Date().toISOString()): Promise<void> {
    await this.outbox.transactionWithNoteGraph(async () => {
      const links = await db.noteLinks
        .filter(
          (link) =>
            link.sourceNoteId === noteId || link.targetNoteId === noteId,
        )
        .toArray();

      for (const link of links) await this.removeLink(link, timestamp);
      await db.noteAliases.where('noteId').equals(noteId).delete();
    });
  }

  async recordAlias(
    noteId: string,
    alias: string,
    createdAt = new Date().toISOString(),
  ): Promise<void> {
    const normalizedAlias = normalizeWikiLinkName(alias);
    if (!normalizedAlias) return;

    const existing = await db.noteAliases
      .where('[noteId+normalizedAlias]')
      .equals([noteId, normalizedAlias])
      .first();
    if (existing) return;

    await db.noteAliases.add({
      id: crypto.randomUUID(),
      noteId,
      alias: alias.trim(),
      normalizedAlias,
      createdAt,
    });
  }

  async resolveUnresolvedLinks(note: NoteRecord): Promise<void> {
    await this.outbox.transactionWithNoteGraph(async () => {
      const aliases = await db.noteAliases.where('noteId').equals(note.id).toArray();
      const names = new Set([
        normalizeWikiLinkName(note.title),
        ...aliases.map((alias) => alias.normalizedAlias),
      ]);
      const unresolved = await db.noteLinks
        .filter(
          (link) =>
            link.targetNoteId === null &&
            !link.deletedAt &&
            names.has(normalizeWikiLinkName(link.targetTitle)),
        )
        .toArray();

      for (const link of unresolved) {
        const duplicate = await db.noteLinks
          .where('[sourceNoteId+targetNoteId]')
          .equals([link.sourceNoteId, note.id])
          .filter((candidate) => !candidate.deletedAt)
          .first();
        if (duplicate) {
          await db.noteLinks.delete(link.id);
          continue;
        }

        const resolved: NoteLinkRecord = {
          ...link,
          targetNoteId: note.id,
          syncStatus: 'pending',
        };
        await db.noteLinks.put(resolved);
        await this.outbox.add(this.createOperation('create', resolved, link.createdAt));
      }
    });
  }

  async aliasesForNote(noteId: string): Promise<NoteAliasRecord[]> {
    return db.noteAliases.where('noteId').equals(noteId).toArray();
  }

  private async rebuild(note: NoteRecord): Promise<void> {
    const [notes, aliases, existingLinks] = await Promise.all([
      db.notes.filter((candidate) => !candidate.deletedAt).toArray(),
      db.noteAliases.toArray(),
      db.noteLinks.where('sourceNoteId').equals(note.id).toArray(),
    ]);
    const desired = new Map<string, { targetTitle: string; targetId: string | null }>();

    for (const targetTitle of extractWikiLinks(note.content)) {
      const target = resolveWikiLinkTarget(targetTitle, notes, aliases);
      const key = target
        ? `resolved:${target.id}`
        : `unresolved:${normalizeWikiLinkName(targetTitle)}`;
      if (!desired.has(key)) {
        desired.set(key, { targetTitle, targetId: target?.id ?? null });
      }
    }

    const timestamp = note.updatedAt;
    for (const link of existingLinks) {
      const key = link.targetNoteId
        ? `resolved:${link.targetNoteId}`
        : `unresolved:${normalizeWikiLinkName(link.targetTitle)}`;
      const match = desired.get(key);
      if (match && !link.deletedAt) {
        desired.delete(key);
        if (link.targetTitle !== match.targetTitle) {
          await db.noteLinks.update(link.id, { targetTitle: match.targetTitle });
        }
      } else {
        await this.removeLink(link, timestamp);
      }
    }

    for (const { targetTitle, targetId } of desired.values()) {
      const link: NoteLinkRecord = {
        id: crypto.randomUUID(),
        sourceNoteId: note.id,
        targetNoteId: targetId,
        targetTitle,
        createdAt: timestamp,
        deletedAt: null,
        version: 0,
        syncStatus: targetId ? 'pending' : 'local',
      };
      await db.noteLinks.add(link);
      if (targetId) {
        await this.outbox.add(this.createOperation('create', link, timestamp));
      }
    }
  }

  private async removeLink(link: NoteLinkRecord, timestamp: string): Promise<void> {
    const operations = await this.outbox.listForEntity(link.id, 'link');
    const pendingCreate = operations.find(
      (operation) =>
        operation.operation === 'create' &&
        (operation.status === 'pending' || operation.status === 'failed'),
    );

    if (pendingCreate || link.syncStatus === 'local') {
      await this.outbox.removeMany(operations.map((operation) => operation.id));
      await db.noteLinks.delete(link.id);
      return;
    }

    const deleted = {
      ...link,
      deletedAt: timestamp,
      syncStatus: 'pending' as const,
    };
    await db.noteLinks.put(deleted);
    const reusable = operations.find(
      (operation) =>
        operation.operation === 'delete' && operation.status !== 'completed',
    );
    if (reusable) {
      await this.outbox.save({ ...reusable, payload: deleted, status: 'pending' });
    } else {
      await this.outbox.add(this.createOperation('delete', deleted, timestamp));
    }
  }

  private createOperation(
    operation: 'create' | 'delete',
    link: NoteLinkRecord,
    createdAt: string,
  ): OutboxRecord {
    return {
      id: crypto.randomUUID(),
      entityId: link.id,
      entityType: 'link',
      operation,
      baseVersion: link.version,
      payload: link,
      createdAt,
      retryCount: 0,
      status: 'pending',
    };
  }

  private async activeNotes(ids: (string | null)[]): Promise<NoteRecord[]> {
    const uniqueIds = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const notes = await db.notes.where('id').anyOf(uniqueIds).toArray();
    const notesById = new Map(notes.map((note) => [note.id, note]));
    return uniqueIds
      .map((id) => notesById.get(id))
      .filter((note): note is NoteRecord => Boolean(note && !note.deletedAt));
  }
}

export const linkRepository = new LinkRepository();
