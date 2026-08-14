/**
 * Migrações da base de dados.
 *
 * Cada migração é um ficheiro `.sql` numerado em `wim/database/migrations`.
 * Regras:
 *   • correm por ordem de nome (001, 002, …), uma vez cada;
 *   • cada uma corre dentro de uma transacção — ou aplica tudo, ou nada;
 *   • guardamos o checksum: se um ficheiro já aplicado for alterado, avisamos
 *     em vez de deixar a base de dados e o código divergirem em silêncio.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Queryable } from './pool.js';
import { getPool } from './pool.js';

const here = dirname(fileURLToPath(import.meta.url));

/** `wim/backend/{src,dist}/database` → `wim/database/migrations` */
export const MIGRATIONS_DIR = join(here, '..', '..', '..', 'database', 'migrations');

const MIGRATIONS_TABLE = 'schema_migrations';

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
  appliedAt: Date;
}

export interface MigrationStatus {
  applied: AppliedMigration[];
  pending: MigrationFile[];
  changed: string[];
}

const checksumOf = (sql: string): string =>
  createHash('sha256').update(sql, 'utf8').digest('hex').slice(0, 32);

export async function loadMigrationFiles(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const names = entries.filter((name) => name.endsWith('.sql')).sort();

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(dir, name), 'utf8');
      return { name, sql, checksum: checksumOf(sql) };
    }),
  );
}

async function ensureMigrationsTable(db: Queryable): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name        text        PRIMARY KEY,
      checksum    text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function readApplied(db: Queryable): Promise<AppliedMigration[]> {
  const result = await db.query<{ name: string; checksum: string; applied_at: Date }>(
    `SELECT name, checksum, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY name`,
  );
  return result.rows.map((row) => ({
    name: row.name,
    checksum: row.checksum,
    appliedAt: row.applied_at,
  }));
}

export async function getMigrationStatus(dir = MIGRATIONS_DIR): Promise<MigrationStatus> {
  const pool = getPool();
  await ensureMigrationsTable(pool);

  const [files, applied] = await Promise.all([loadMigrationFiles(dir), readApplied(pool)]);
  const appliedByName = new Map(applied.map((m) => [m.name, m]));

  return {
    applied,
    pending: files.filter((file) => !appliedByName.has(file.name)),
    changed: files
      .filter((file) => {
        const previous = appliedByName.get(file.name);
        return previous !== undefined && previous.checksum !== file.checksum;
      })
      .map((file) => file.name),
  };
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: number;
}

/** Aplica todas as migrações pendentes, por ordem. */
export async function migrateUp(dir = MIGRATIONS_DIR): Promise<MigrateResult> {
  const status = await getMigrationStatus(dir);

  if (status.changed.length > 0) {
    throw new Error(
      `Migrações já aplicadas foram alteradas: ${status.changed.join(', ')}. ` +
        'Nunca edite uma migração aplicada — crie uma nova.',
    );
  }

  const pool = getPool();
  const applied: string[] = [];

  // Sequencial e não em paralelo: a ordem das migrações é significativa.
  for (const migration of status.pending) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (name, checksum) VALUES ($1, $2)`,
        [migration.name, migration.checksum],
      );
      await client.query('COMMIT');
      applied.push(migration.name);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Falha na migração ${migration.name}: ${reason}`);
    } finally {
      client.release();
    }
  }

  return { applied, alreadyApplied: status.applied.length };
}
