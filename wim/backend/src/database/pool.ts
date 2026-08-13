/**
 * Ligação ao PostgreSQL.
 *
 * Este é o único módulo que cria ligações. Os repositórios recebem um
 * executor (`Queryable`) e nunca criam ligações próprias — assim uma
 * transacção pode atravessar vários repositórios sem truques.
 */
import pg from 'pg';
import { getEnv } from '../config/env.js';

const { Pool } = pg;

/** Qualquer coisa capaz de executar SQL: o pool, ou um cliente em transacção. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (pool) return pool;

  const env = getEnv();

  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: 'wim-backend',
  });

  // Um erro num cliente inactivo não deve derrubar o processo.
  // Usamos console.error e não o logger: isto pode acontecer durante o
  // arranque ou o encerramento, quando o logger já não está disponível.
  pool.on('error', (error) => {
    console.error('[db] erro num cliente inactivo do pool:', error.message);
  });

  return pool;
}

/** Fecha o pool. Usado no encerramento gracioso e entre testes. */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}

export interface DatabaseHealth {
  connected: boolean;
  latencyMs: number;
  serverVersion?: string;
  error?: string;
}

/**
 * Verifica se a base de dados responde. Usada por `GET /api/health`.
 * Nunca lança — devolve sempre um diagnóstico.
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const startedAt = performance.now();

  try {
    const result = await getPool().query<{ version: string }>('SELECT version() AS version');
    const version = result.rows[0]?.version ?? '';

    return {
      connected: true,
      latencyMs: Math.round(performance.now() - startedAt),
      // "PostgreSQL 16.13 on x86_64…" → "PostgreSQL 16.13"
      serverVersion: version.split(' ').slice(0, 2).join(' ') || undefined,
    };
  } catch (error) {
    return {
      connected: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Corre `fn` dentro de uma transacção. Faz COMMIT se correr bem e ROLLBACK
 * se lançar. O cliente é sempre devolvido ao pool.
 */
export async function withTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
