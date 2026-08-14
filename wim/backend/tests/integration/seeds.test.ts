/**
 * Dados de exemplo.
 *
 * A primeira versão destes seeds duplicava preços e perguntas frequentes de
 * cada vez que era corrida: `ON CONFLICT DO NOTHING` só actua quando existe
 * uma constraint única para violar, e essas tabelas não tinham nenhuma.
 * O teste abaixo existe para isso não voltar a acontecer sem se notar.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../../src/database/pool.js';
import { runSeeds } from '../../src/database/seeder.js';
import { freshSchema } from '../helpers/fixtures.js';

const TABLES = [
  'contacts',
  'company_services',
  'company_prices',
  'company_faqs',
  'tags',
] as const;

async function countRows(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  for (const table of TABLES) {
    const result = await getPool().query<{ count: string }>(
      `SELECT count(*) AS count FROM ${table}`,
    );
    counts[table] = Number(result.rows[0]!.count);
  }

  return counts;
}

describe('seeds de desenvolvimento', () => {
  let afterFirstRun: Record<string, number>;

  beforeAll(async () => {
    await freshSchema();
  });

  afterAll(async () => {
    await closePool();
  });

  it('insere os dados de exemplo', async () => {
    await runSeeds();
    afterFirstRun = await countRows();

    for (const table of TABLES) {
      expect(afterFirstRun[table], `${table} devia ter dados`).toBeGreaterThan(0);
    }
  });

  it('correr uma segunda vez não duplica nada', async () => {
    await runSeeds();
    expect(await countRows()).toEqual(afterFirstRun);
  });

  it('correr uma terceira vez continua a não duplicar', async () => {
    await runSeeds();
    expect(await countRows()).toEqual(afterFirstRun);
  });

  it('deixa apenas os preços de tabela visíveis para a IA', async () => {
    const result = await getPool().query<{ label: string }>(
      `SELECT label FROM company_prices WHERE is_authorized_for_ai ORDER BY label`,
    );

    const labels = result.rows.map((row) => row.label);

    // Valores fixos: podem ser comunicados sem negociação.
    expect(labels).toContain('Visita técnica inicial');
    // Valores que dependem de área, complexidade ou negociação: nunca.
    expect(labels).not.toContain('Projecto de moradia (por m2)');
    expect(labels).not.toContain('Fiscalização mensal');
  });

  it('cria o perfil da empresa com a resposta automática desligada', async () => {
    const result = await getPool().query<{ name: string; auto_reply_enabled: boolean }>(
      `SELECT name, auto_reply_enabled FROM company_profile WHERE id = 1`,
    );

    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.auto_reply_enabled).toBe(false);
  });

  it('usa apenas números de telefone que não pertencem a ninguém', async () => {
    // Os dados de exemplo nunca devem conter contactos reais.
    const result = await getPool().query<{ phone_e164: string }>(
      `SELECT phone_e164 FROM contacts`,
    );

    for (const row of result.rows) {
      expect(row.phone_e164).toMatch(/^\+25884000000\d$/);
    }
  });
});
