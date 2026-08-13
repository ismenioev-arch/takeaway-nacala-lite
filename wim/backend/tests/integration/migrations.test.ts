/**
 * Testes das migrações contra um PostgreSQL real.
 *
 * Verificam três coisas que importam a longo prazo:
 *   • a migração aplica-se e cria o que promete;
 *   • correr duas vezes não faz nada da segunda vez (idempotência);
 *   • alterar uma migração já aplicada é detectado, não ignorado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../../src/database/pool.js';
import {
  getMigrationStatus,
  loadMigrationFiles,
  migrateUp,
  MIGRATIONS_DIR,
} from '../../src/database/migrator.js';
import { enumValues, resetSchema, tableExists } from '../helpers/database.js';

describe('migrações', () => {
  beforeAll(async () => {
    await resetSchema();
  });

  afterAll(async () => {
    await closePool();
  });

  it('encontra os ficheiros de migração no directório partilhado', async () => {
    const files = await loadMigrationFiles();

    expect(files.length).toBeGreaterThan(0);
    expect(files[0]?.name).toBe('001_initial.sql');
    expect(files[0]?.checksum).toMatch(/^[0-9a-f]{32}$/);
  });

  it('mantém os ficheiros por ordem numérica', async () => {
    const names = (await loadMigrationFiles()).map((file) => file.name);
    expect(names).toEqual([...names].sort());
  });

  it('aplica as migrações pendentes', async () => {
    const result = await migrateUp();

    expect(result.applied).toContain('001_initial.sql');
    expect(await tableExists('schema_migrations')).toBe(true);
  });

  it('cria as tabelas da FASE 1', async () => {
    expect(await tableExists('users')).toBe(true);
    expect(await tableExists('settings')).toBe(true);
  });

  it('NÃO cria ainda as tabelas das fases seguintes', async () => {
    // Guarda contra alguém adiantar trabalho para dentro da migração 001.
    for (const table of ['messages', 'conversations', 'contacts', 'ai_drafts']) {
      expect(await tableExists(table)).toBe(false);
    }
  });

  it('cria os tipos enumerados com os valores da especificação', async () => {
    expect(await enumValues('message_priority')).toEqual([
      'URGENTE',
      'IMPORTANTE',
      'ACOMPANHAR',
      'NORMAL',
    ]);

    expect(await enumValues('conversation_status')).toEqual([
      'NEW',
      'OPEN',
      'WAITING_HUMAN',
      'WAITING_CUSTOMER',
      'FOLLOW_UP',
      'RESOLVED',
      'ARCHIVED',
    ]);

    expect(await enumValues('message_status')).toEqual([
      'RECEIVED',
      'ANALYZING',
      'ANALYZED',
      'DRAFTED',
      'APPROVED',
      'SENT',
      'DELIVERED',
      'READ',
      'FAILED',
    ]);

    expect(await enumValues('message_intent')).toHaveLength(15);
    expect(await enumValues('automation_level')).toEqual(['AUTO', 'DRAFT', 'HUMAN_REQUIRED']);
    expect(await enumValues('user_role')).toEqual(['OWNER', 'ADMIN', 'AGENT']);
  });

  it('ordena a prioridade da mais grave para a menos grave', async () => {
    // URGENTE tem de vir primeiro num ORDER BY, senão o dashboard mostra
    // a coisa errada no topo (especificação, secções 9 e 28).
    const result = await getPool().query<{ priority: string }>(
      `SELECT unnest(enum_range(NULL::message_priority)) AS priority ORDER BY 1`,
    );

    expect(result.rows.map((row) => row.priority)[0]).toBe('URGENTE');
  });

  it('é idempotente — correr de novo não aplica nada', async () => {
    const result = await migrateUp();
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toBeGreaterThan(0);
  });

  it('grava definições iniciais, com a automação DESLIGADA por omissão', async () => {
    const result = await getPool().query<{ key: string; value: unknown }>(
      `SELECT key, value FROM settings ORDER BY key`,
    );

    const settings = new Map(result.rows.map((row) => [row.key, row.value]));

    expect(settings.get('ai.automation_enabled')).toBe(false);
    expect(settings.get('ai.confidence_threshold')).toBe(0.9);
  });

  it('recusa uma chave de definição com formato inválido', async () => {
    await expect(
      getPool().query(`INSERT INTO settings (key, value) VALUES ('Chave Inválida', '1'::jsonb)`),
    ).rejects.toThrow(/settings_key_format/);
  });

  it('detecta uma migração alterada depois de aplicada', async () => {
    // Simula a alteração mudando o checksum guardado.
    await getPool().query(
      `UPDATE schema_migrations SET checksum = 'checksum-diferente' WHERE name = $1`,
      ['001_initial.sql'],
    );

    const status = await getMigrationStatus(MIGRATIONS_DIR);
    expect(status.changed).toContain('001_initial.sql');

    await expect(migrateUp()).rejects.toThrow(/foram alteradas/);

    // Repõe, para não afectar outros testes.
    const [file] = await loadMigrationFiles();
    await getPool().query(`UPDATE schema_migrations SET checksum = $1 WHERE name = $2`, [
      file?.checksum,
      '001_initial.sql',
    ]);
  });
});

describe('tabela users', () => {
  afterAll(async () => {
    await getPool().query('DELETE FROM users');
  });

  it('aceita um utilizador válido e preenche os valores por omissão', async () => {
    const result = await getPool().query<{
      id: string;
      role: string;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ('dono@exemplo.mz', '$argon2id$fake', 'Dono do Projecto')
       RETURNING id, role, is_active, created_at, updated_at`,
    );

    const user = result.rows[0];
    expect(user?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user?.role).toBe('AGENT');
    expect(user?.is_active).toBe(true);
  });

  it('trata o e-mail sem distinguir maiúsculas (citext)', async () => {
    await expect(
      getPool().query(
        `INSERT INTO users (email, password_hash, name)
         VALUES ('DONO@EXEMPLO.MZ', '$argon2id$fake', 'Duplicado')`,
      ),
    ).rejects.toThrow(/users_email_key/);
  });

  it('recusa um e-mail com formato inválido', async () => {
    await expect(
      getPool().query(
        `INSERT INTO users (email, password_hash, name)
         VALUES ('nao-e-email', '$argon2id$fake', 'Teste')`,
      ),
    ).rejects.toThrow(/users_email_format/);
  });

  it('recusa um nome vazio', async () => {
    await expect(
      getPool().query(
        `INSERT INTO users (email, password_hash, name)
         VALUES ('outro@exemplo.mz', '$argon2id$fake', '   ')`,
      ),
    ).rejects.toThrow(/users_name_not_blank/);
  });

  it('actualiza updated_at automaticamente', async () => {
    const before = await getPool().query<{ updated_at: Date }>(
      `SELECT updated_at FROM users WHERE email = 'dono@exemplo.mz'`,
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    await getPool().query(`UPDATE users SET name = 'Nome Novo' WHERE email = 'dono@exemplo.mz'`);

    const after = await getPool().query<{ updated_at: Date }>(
      `SELECT updated_at FROM users WHERE email = 'dono@exemplo.mz'`,
    );

    expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThan(
      before.rows[0]!.updated_at.getTime(),
    );
  });
});
