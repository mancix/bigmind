import { SCHEMA_META_TABLE, SQLITE_TABLES } from './sqlite-schema.js';
import type { SqliteDriver, SqliteTransaction } from './sqlite-driver.js';

/**
 * Versioned schema migration.
 *
 * Each step is applied inside its own transaction and the resulting version is
 * recorded in `schema_meta`, so a partially-applied migration can never leave
 * the database in an unknown state.
 */
export interface SqliteMigration {
  version: number;
  up: (transaction: SqliteTransaction) => Promise<void>;
}

/** Version of the initial BigMind client schema (mirrors Dexie v11). */
export const INITIAL_SCHEMA_VERSION = 1;

function createTableStatement(table: (typeof SQLITE_TABLES)[number]): string {
  const columns = [
    `"${table.keyColumn}" TEXT PRIMARY KEY NOT NULL`,
    `"${table.dataColumn}" TEXT NOT NULL`,
    ...Object.values(table.indexColumns).map(
      (column) => `"${column}" TEXT`,
    ),
  ];
  return `CREATE TABLE IF NOT EXISTS "${table.table}" (${columns.join(', ')});`;
}

function createIndexStatements(
  table: (typeof SQLITE_TABLES)[number],
): string[] {
  const statements: string[] = [];
  for (const column of Object.values(table.indexColumns)) {
    statements.push(
      `CREATE INDEX IF NOT EXISTS "idx_${table.table}_${column}" ON "${table.table}" ("${column}");`,
    );
  }
  for (const compound of table.compoundIndexes) {
    const parts = compound
      .slice(1, -1)
      .split('+')
      .map((part) => table.indexColumns[part])
      .filter(Boolean);
    if (parts.length > 0) {
      const name = `idx_${table.table}_${parts.join('_')}`;
      statements.push(
        `CREATE INDEX IF NOT EXISTS "${name}" ON "${table.table}" (${parts
          .map((part) => `"${part}"`)
          .join(', ')});`,
      );
    }
  }
  return statements;
}

/**
 * The initial schema migration: every BigMind table plus the meta table.
 *
 * New migrations are appended with strictly increasing versions; each `up`
 * step should be additive (new tables/columns/indexes) so existing clients
 * upgrade in place.
 */
export function buildInitialSqliteMigrations(): SqliteMigration[] {
  const statements: string[] = [
    `CREATE TABLE IF NOT EXISTS "${SCHEMA_META_TABLE}" (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL);`,
  ];
  for (const table of SQLITE_TABLES) {
    statements.push(createTableStatement(table));
    statements.push(...createIndexStatements(table));
  }

  return [
    {
      version: INITIAL_SCHEMA_VERSION,
      up: async (transaction) => {
        for (const statement of statements) {
          await transaction.execAsync(statement);
        }
      },
    },
  ];
}

/** Read the currently recorded schema version (0 when the DB is fresh). */
export async function getSqliteSchemaVersion(
  driver: SqliteDriver,
): Promise<number> {
  await driver.execAsync(
    `CREATE TABLE IF NOT EXISTS "${SCHEMA_META_TABLE}" (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL);`,
  );
  const row = await driver.getFirstAsync<{ version: number | bigint }>(
    `SELECT version FROM "${SCHEMA_META_TABLE}" WHERE id = 1;`,
  );
  if (!row) {
    return 0;
  }
  return Number(row.version);
}

/**
 * Apply pending migrations in version order. Each migration runs inside its
 * own transaction; the recorded version is updated atomically with the
 * migration itself. Idempotent: calling again after success is a no-op.
 *
 * @returns the schema version after the run.
 */
export async function runSqliteMigrations(
  driver: SqliteDriver,
  migrations: SqliteMigration[],
): Promise<number> {
  const current = await getSqliteSchemaVersion(driver);
  const pending = migrations
    .filter((migration) => migration.version > current)
    .sort((left, right) => left.version - right.version);

  for (const migration of pending) {
    await driver.withTransactionAsync(async (transaction) => {
      await migration.up(transaction);
      await transaction.runAsync(
        `INSERT INTO "${SCHEMA_META_TABLE}" (id, version) VALUES (1, ?) ` +
          `ON CONFLICT(id) DO UPDATE SET version = excluded.version;`,
        migration.version,
      );
    });
  }

  return pending.length > 0 ? pending[pending.length - 1].version : current;
}