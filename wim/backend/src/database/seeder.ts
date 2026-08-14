/**
 * Dados de exemplo para desenvolvimento.
 *
 * Recusa correr em produção. Os ficheiros de seed são idempotentes
 * (`ON CONFLICT DO NOTHING`), por isso podem ser corridos várias vezes.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnv } from '../config/env.js';
import { getPool } from './pool.js';

const here = dirname(fileURLToPath(import.meta.url));

/** `wim/backend/{src,dist}/database` → `wim/database/seeds` */
export const SEEDS_DIR = join(here, '..', '..', '..', 'database', 'seeds');

export class SeedNotAllowedError extends Error {
  constructor() {
    super(
      'Os dados de exemplo não podem ser inseridos em produção. ' +
        'Se precisa mesmo disto, mude NODE_ENV.',
    );
    this.name = 'SeedNotAllowedError';
  }
}

export interface SeedResult {
  applied: string[];
}

export async function runSeeds(dir = SEEDS_DIR): Promise<SeedResult> {
  if (getEnv().NODE_ENV === 'production') {
    throw new SeedNotAllowedError();
  }

  const entries = await readdir(dir);
  const files = entries.filter((name) => name.endsWith('.sql')).sort();

  const pool = getPool();
  const applied: string[] = [];

  // Sequencial: um seed pode depender de dados criados pelo anterior.
  for (const name of files) {
    const sql = await readFile(join(dir, name), 'utf8');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      applied.push(name);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Falha no seed ${name}: ${reason}`);
    } finally {
      client.release();
    }
  }

  return { applied };
}
