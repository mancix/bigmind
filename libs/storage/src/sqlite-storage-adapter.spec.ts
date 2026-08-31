import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { NoteRecord } from './records.js';
import type { StorageAdapter } from './storage-adapter.js';
import { createInMemoryStorage } from './storage-adapter.js';
import { createNodeSqliteDriver } from './node-sqlite-driver.js';
import {
  buildInitialSqliteMigrations,
  getSqliteSchemaVersion,
  INITIAL_SCHEMA_VERSION,
  runSqliteMigrations,
  type SqliteMigration,
} from './sqlite-migrations.js';
import { createSqliteStorageAdapter } from './sqlite-storage-adapter.js';
import type { SqliteDriver } from './sqlite-driver.js';

function makeNote(id: string, overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id,
    title: `Note ${id}`,
    content: 'Hello world',
    categoryId: null,
    templateType: 'MARKDOWN',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    version: 0,
    syncStatus: 'pending',
    ...overrides,
  };
}

const ID_A = '11111111-1111-4111-8111-111111111111';

/** A v2 migration fixture: adds a queried column + index to `notes`. */
const v2Migration: SqliteMigration = {
  version: 2,
  up: async (transaction) => {
    await transaction.execAsync(
      'ALTER TABLE notes ADD COLUMN pinned INTEGER;',
    );
    await transaction.execAsync(
      'CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes (pinned);',
    );
  },
};

describe('SqliteStorageAdapter', () => {
  describe('migrations', () => {
    it('initializes a fresh database to the initial schema version', async () => {
      const driver = createNodeSqliteDriver(':memory:');
      const storage = createSqliteStorageAdapter(driver);

      await storage.open();
      expect(await getSqliteSchemaVersion(driver)).toBe(INITIAL_SCHEMA_VERSION);

      // Schema is usable end-to-end.
      await storage.notes.add(makeNote(ID_A, { syncStatus: 'pending' }));
      expect(await storage.notes.get(ID_A)).toMatchObject({ id: ID_A });
      expect(await storage.outbox.count()).toBe(0);
    });

    it('applies pending migrations in order and records the version', async () => {
      const driver = createNodeSqliteDriver(':memory:');
      const migrations = [...buildInitialSqliteMigrations(), v2Migration];

      const storage = createSqliteStorageAdapter(driver, migrations);
      await storage.open();

      const version = await getSqliteSchemaVersion(driver);
      expect(version).toBe(2);
    });

    it('is idempotent: re-running migrations is a no-op', async () => {
      const driver = createNodeSqliteDriver(':memory:');
      const migrations = [...buildInitialSqliteMigrations(), v2Migration];

      await runSqliteMigrations(driver, migrations);
      const versionAfterFirstRun = await getSqliteSchemaVersion(driver);
      await runSqliteMigrations(driver, migrations);
      expect(await getSqliteSchemaVersion(driver)).toBe(versionAfterFirstRun);
    });

    it('preserves existing rows when a new migration runs', async () => {
      const driver = createNodeSqliteDriver(':memory:');

      // Open with v1 only and write data.
      const first = createSqliteStorageAdapter(driver, buildInitialSqliteMigrations());
      await first.open();
      await first.notes.add(makeNote(ID_A, { title: 'Before upgrade' }));

      // Reopen with v1 + v2: the migration must not destroy data.
      const upgraded = createSqliteStorageAdapter(driver, [
        ...buildInitialSqliteMigrations(),
        v2Migration,
      ]);
      await upgraded.open();

      expect(await getSqliteSchemaVersion(driver)).toBe(2);
      expect((await upgraded.notes.get(ID_A))?.title).toBe('Before upgrade');
    });

    it('does not rerun migrations for databases already on the latest version', async () => {
      const driver = createNodeSqliteDriver(':memory:');
      const migrations = [...buildInitialSqliteMigrations(), v2Migration];
      await runSqliteMigrations(driver, migrations);

      let ran = 0;
      const observing: SqliteMigration[] = [
        ...migrations,
        { version: 2, up: async () => { ran += 1; } },
      ];
      await runSqliteMigrations(driver, observing);
      expect(ran).toBe(0);
    });

    it('rolls back a failed migration atomically', async () => {
      const driver = createNodeSqliteDriver(':memory:');
      const broken: SqliteMigration = {
        version: 2,
        up: async (transaction) => {
          await transaction.execAsync('CREATE TABLE half_migrated (id TEXT);');
          throw new Error('boom');
        },
      };

      await expect(
        runSqliteMigrations(driver, [...buildInitialSqliteMigrations(), broken]),
      ).rejects.toThrow('boom');

      // Transaction rolled back: table gone, version still 1.
      await expect(
        driver.getFirstAsync('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'half_migrated\';'),
      ).resolves.toBeNull();
      expect(await getSqliteSchemaVersion(driver)).toBe(INITIAL_SCHEMA_VERSION);
    });
  });

  describe('persistence', () => {
    it('survives close + reopen (app restart / device reboot analogue)', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'bigmind-sqlite-'));
      const dbPath = join(dir, 'bigmind.db');
      const closeAdapter = (adapter: StorageAdapter) => adapter.close();

      try {
        // Session 1: write data and close (simulates app exit).
        const session1 = createSqliteStorageAdapter(
          createNodeSqliteDriver(dbPath),
        );
        await session1.open();
        await session1.notes.add(makeNote(ID_A, { title: 'Survives restart' }));
        await session1.syncState.put({ key: 'cursor', value: '42' });
        await session1.outbox.add({
          id: '22222222-2222-4222-8222-222222222222',
          entityId: ID_A,
          entityType: 'note',
          operation: 'create',
          baseVersion: 0,
          payload: makeNote(ID_A),
          createdAt: '2025-01-01T00:00:00.000Z',
          retryCount: 0,
          status: 'pending',
        });
        closeAdapter(session1);

        // Session 2: reopen the same file (long offline period → new boot).
        const session2 = createSqliteStorageAdapter(
          createNodeSqliteDriver(dbPath),
        );
        await session2.open();

        expect((await session2.notes.get(ID_A))?.title).toBe('Survives restart');
        expect(await session2.syncState.get('cursor')).toEqual({
          key: 'cursor',
          value: '42',
        });
        expect(await session2.outbox.count()).toBe(1);

        const pending = await session2.outbox
          .where('status')
          .anyOf('pending', 'failed')
          .toArray();
        expect(pending).toHaveLength(1);
        closeAdapter(session2);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('delete() destroys the database; open() recreates it empty', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'bigmind-sqlite-'));
      const dbPath = join(dir, 'bigmind.db');
      let driver: SqliteDriver = createNodeSqliteDriver(dbPath);

      try {
        let storage = createSqliteStorageAdapter(driver);
        await storage.open();
        await storage.notes.add(makeNote(ID_A));

        await storage.delete();

        // Reopened file is a fresh database.
        driver = createNodeSqliteDriver(dbPath);
        storage = createSqliteStorageAdapter(driver);
        await storage.open();
        expect(await storage.notes.count()).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('rolls back a failing transaction, keeping earlier commits', async () => {
      const storage = createSqliteStorageAdapter(createNodeSqliteDriver(':memory:'));
      const note = makeNote(ID_A);
      await storage.notes.add(note);

      await expect(
        storage.transaction(async () => {
          await storage.notes.add(makeNote('33333333-3333-4333-8333-333333333333'));
          throw new Error('transaction failed');
        }),
      ).rejects.toThrow('transaction failed');

      expect(await storage.notes.count()).toBe(1);
      expect(await storage.notes.get(ID_A)).toEqual(note);
    });

    it('returns results consistent with the in-memory adapter for the same workload', async () => {
      const memory = createInMemoryStorage();
      const sqlite = createSqliteStorageAdapter(
        createNodeSqliteDriver(':memory:'),
      );
      const seed = async (storage: StorageAdapter) => {
        await storage.notes.bulkAdd([
          makeNote(ID_A, { categoryId: 'cat-a', updatedAt: '2025-01-03T00:00:00.000Z' }),
          makeNote('22222222-2222-4222-8222-222222222222', {
            categoryId: null,
            updatedAt: '2025-01-01T00:00:00.000Z',
          }),
        ]);
      };

      await seed(memory);
      await seed(sqlite);

      const result = async (storage: StorageAdapter) => ({
        newest: (await storage.notes.orderBy('updatedAt').reverse().toArray()).map(
          (n) => n.id,
        ),
        catA: (await storage.notes.where('categoryId').equals('cat-a').count()),
        updated: await storage.notes.update(ID_A, { syncStatus: 'synced' }),
        synced: await storage.notes
          .where('syncStatus')
          .equals('synced')
          .count(),
      });

      expect(await result(sqlite)).toEqual(await result(memory));
    });
  });
});