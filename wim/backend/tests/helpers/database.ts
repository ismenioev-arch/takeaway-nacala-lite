/**
 * Utilitários para os testes de integração.
 *
 * A função `resetSchema` apaga tudo. Por isso, recusa-se a correr contra
 * qualquer base de dados cujo nome não termine em `_test`. É uma salvaguarda
 * barata contra o pior erro possível: um teste apagar dados reais.
 */
import { getPool } from '../../src/database/pool.js';

export function assertTestDatabase(): void {
  const url = process.env['DATABASE_URL'] ?? '';
  const databaseName = url.split('/').pop()?.split('?')[0] ?? '';

  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Recusado: os testes de integração só correm contra uma base de dados ` +
        `terminada em "_test". DATABASE_URL aponta para "${databaseName}".`,
    );
  }
}

/** Deixa a base de dados de testes completamente vazia. */
export async function resetSchema(): Promise<void> {
  assertTestDatabase();

  const pool = getPool();
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

export async function tableExists(name: string): Promise<boolean> {
  const result = await getPool().query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [name],
  );
  return result.rows[0]?.exists ?? false;
}

export async function enumValues(typeName: string): Promise<string[]> {
  const result = await getPool().query<{ label: string }>(
    `SELECT e.enumlabel AS label
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = $1
      ORDER BY e.enumsortorder`,
    [typeName],
  );
  return result.rows.map((row) => row.label);
}
