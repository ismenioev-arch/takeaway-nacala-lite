/**
 * `/api/contacts` — cadastro de contactos (especificação, secção 13).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, getPool } from '../../src/database/pool.js';
import type { ContactDto } from '../../src/dtos/contact.dto.js';
import type { Paginated } from '../../src/dtos/common.dto.js';
import { freshSchema } from '../helpers/fixtures.js';
import {
  authenticateAs,
  query,
  startTestApp,
  type ApiErrorBody,
  type AuthenticatedClient,
} from '../helpers/api.js';

let app: FastifyInstance;
/** Cliente com sessão iniciada: a partir da FASE 4 a API exige-a. */
let api: AuthenticatedClient['call'];

beforeAll(async () => {
  await freshSchema();
  app = await startTestApp();
  api = (await authenticateAs(app, { role: 'OWNER' })).call;
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('POST /api/contacts', () => {
  it('cria um contacto e devolve 201', async () => {
    const { status, body } = await api<ContactDto>({
      method: 'POST',
      url: '/api/contacts',
      payload: {
        phone: '+258840001111',
        displayName: 'João Macuácua',
        company: 'Construções Exemplo',
        category: 'CLIENTE',
      },
    });

    expect(status).toBe(201);
    expect(body.name).toBe('João Macuácua');
    expect(body.phone).toBe('+258840001111');
    expect(body.category).toBe('CLIENTE');
    // O identificador do WhatsApp é derivado do telefone quando não é dado,
    // para que o contacto criado à mão se ligue à primeira mensagem que chegar.
    expect(body.waId).toBe('258840001111');
  });

  it('regista a criação na auditoria (secção 24)', async () => {
    const result = await getPool().query<{ action: string; new_value: unknown }>(
      `SELECT action, new_value FROM audit_logs WHERE entity_type = 'contacts'`,
    );

    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.action).toBe('contact.created');
  });

  it('recusa um telefone fora do formato internacional', async () => {
    const { status, body } = await api<ApiErrorBody>({
      method: 'POST',
      url: '/api/contacts',
      payload: { phone: '840001111' },
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.[0]?.field).toBe('phone');
    expect(body.error.details?.[0]?.message).toContain('+258840001234');
  });

  it('recusa um contacto repetido com 409, não com erro de base de dados', async () => {
    const { status, body } = await api<ApiErrorBody>({
      method: 'POST',
      url: '/api/contacts',
      payload: { phone: '+258840001111' },
    });

    expect(status).toBe(409);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toContain('Já existe um contacto');
  });

  it('recusa uma categoria inventada', async () => {
    const { status } = await api({
      method: 'POST',
      url: '/api/contacts',
      payload: { phone: '+258840009999', category: 'VIP' },
    });

    expect(status).toBe(400);
  });
});

describe('GET /api/contacts', () => {
  beforeAll(async () => {
    for (const [phone, name, category] of [
      ['+258840002222', 'Ana Sitoe', 'PROSPECT'],
      ['+258840003333', 'Cimentos Exemplo', 'FORNECEDOR'],
      ['+258840004444', 'Carlos Bila', 'CLIENTE'],
    ] as const) {
      await api({
        method: 'POST',
        url: '/api/contacts',
        payload: { phone, displayName: name, category },
      });
    }
  });

  it('devolve a lista com o envelope de paginação', async () => {
    const { status, body } = await api<Paginated<ContactDto>>({
      method: 'GET',
      url: '/api/contacts',
    });

    expect(status).toBe(200);
    expect(body.data.length).toBe(4);
    expect(body.pagination).toMatchObject({
      page: 1,
      pageSize: 25,
      total: 4,
      totalPages: 1,
      hasNext: false,
      hasPrevious: false,
    });
  });

  it('pagina correctamente', async () => {
    const { body } = await api<Paginated<ContactDto>>({
      method: 'GET',
      url: `/api/contacts${query({ page: 1, pageSize: 2 })}`,
    });

    expect(body.data).toHaveLength(2);
    expect(body.pagination.totalPages).toBe(2);
    expect(body.pagination.hasNext).toBe(true);

    const second = await api<Paginated<ContactDto>>({
      method: 'GET',
      url: `/api/contacts${query({ page: 2, pageSize: 2 })}`,
    });

    expect(second.body.pagination.hasPrevious).toBe(true);
    // Sem sobreposição entre páginas.
    const firstIds = body.data.map((c) => c.id);
    expect(second.body.data.every((c) => !firstIds.includes(c.id))).toBe(true);
  });

  it('filtra por categoria', async () => {
    const { body } = await api<Paginated<ContactDto>>({
      method: 'GET',
      url: `/api/contacts${query({ category: 'CLIENTE' })}`,
    });

    expect(body.data).toHaveLength(2);
    expect(body.data.every((c) => c.category === 'CLIENTE')).toBe(true);
  });

  it('aceita várias categorias no mesmo pedido', async () => {
    const { body } = await api<Paginated<ContactDto>>({
      method: 'GET',
      url: `/api/contacts${query({ category: ['CLIENTE', 'FORNECEDOR'] })}`,
    });

    expect(body.data).toHaveLength(3);
  });

  it('pesquisa por nome parcial', async () => {
    const { body } = await api<Paginated<ContactDto>>({
      method: 'GET',
      url: `/api/contacts${query({ q: 'sitoe' })}`,
    });

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.name).toBe('Ana Sitoe');
  });

  it('pesquisa por telefone parcial', async () => {
    const { body } = await api<Paginated<ContactDto>>({
      method: 'GET',
      url: `/api/contacts${query({ q: '840003333' })}`,
    });

    expect(body.data).toHaveLength(1);
  });

  it('recusa uma pesquisa demasiado curta', async () => {
    const { status } = await api({
      method: 'GET',
      url: `/api/contacts${query({ q: 'a' })}`,
    });

    expect(status).toBe(400);
  });

  it('recusa um pageSize acima do limite', async () => {
    const { status, body } = await api<ApiErrorBody>({
      method: 'GET',
      url: `/api/contacts${query({ pageSize: 5000 })}`,
    });

    expect(status).toBe(400);
    expect(body.error.details?.[0]?.field).toBe('pageSize');
  });

  it('recusa uma coluna de ordenação não permitida', async () => {
    // Impede que a ordenação seja usada como via de injecção de SQL.
    const { status } = await api({
      method: 'GET',
      url: `/api/contacts${query({ sortBy: 'password_hash' })}`,
    });

    expect(status).toBe(400);
  });

  it('ordena por nome ascendente', async () => {
    const { body } = await api<Paginated<ContactDto>>({
      method: 'GET',
      url: `/api/contacts${query({ sortBy: 'name', sortDirection: 'asc' })}`,
    });

    const names = body.data.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe('GET /api/contacts/:id', () => {
  it('devolve 404 para um identificador inexistente', async () => {
    const { status, body } = await api<ApiErrorBody>({
      method: 'GET',
      url: '/api/contacts/00000000-0000-4000-8000-000000000000',
    });

    expect(status).toBe(404);
    expect(body.error.message).toBe('Contacto não encontrado.');
  });

  it('devolve 400 quando o identificador não é um UUID', async () => {
    const { status, body } = await api<ApiErrorBody>({
      method: 'GET',
      url: '/api/contacts/nao-e-uuid',
    });

    expect(status).toBe(400);
    expect(body.error.details?.[0]?.field).toBe('id');
  });
});

describe('PATCH /api/contacts/:id', () => {
  let contactId: string;

  beforeAll(async () => {
    const { body } = await api<ContactDto>({
      method: 'POST',
      url: '/api/contacts',
      payload: { phone: '+258840005555', displayName: 'Nome Inicial' },
    });
    contactId = body.id;
  });

  it('actualiza apenas os campos indicados', async () => {
    const { status, body } = await api<ContactDto>({
      method: 'PATCH',
      url: `/api/contacts/${contactId}`,
      payload: { displayName: 'Nome Corrigido', category: 'CLIENTE' },
    });

    expect(status).toBe(200);
    expect(body.name).toBe('Nome Corrigido');
    expect(body.category).toBe('CLIENTE');
    expect(body.phone).toBe('+258840005555');
  });

  it('regista a alteração com o valor antigo e o novo', async () => {
    const result = await getPool().query<{ old_value: Record<string, unknown>; new_value: Record<string, unknown> }>(
      `SELECT old_value, new_value FROM audit_logs
        WHERE action = 'contact.updated' AND entity_id = $1`,
      [contactId],
    );

    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.old_value['display_name']).toBe('Nome Inicial');
    expect(result.rows[0]!.new_value['display_name']).toBe('Nome Corrigido');
  });

  it('não regista auditoria quando nada muda', async () => {
    const before = await getPool().query(`SELECT count(*) FROM audit_logs`);

    await api({
      method: 'PATCH',
      url: `/api/contacts/${contactId}`,
      payload: { displayName: 'Nome Corrigido' },
    });

    const after = await getPool().query(`SELECT count(*) FROM audit_logs`);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('recusa um PATCH vazio', async () => {
    const { status } = await api({
      method: 'PATCH',
      url: `/api/contacts/${contactId}`,
      payload: {},
    });

    expect(status).toBe(400);
  });

  it('ignora campos que não são actualizáveis', async () => {
    // Enviar `phone` ou `waId` não deve alterá-los: são a identidade do
    // contacto e mudá-los partiria a ligação ao WhatsApp.
    await api({
      method: 'PATCH',
      url: `/api/contacts/${contactId}`,
      payload: { displayName: 'Outro Nome', phone: '+351999999999', waId: 'hackeado' },
    });

    const { body } = await api<ContactDto>({
      method: 'GET',
      url: `/api/contacts/${contactId}`,
    });

    expect(body.phone).toBe('+258840005555');
    expect(body.waId).toBe('258840005555');
  });
});

describe('DELETE /api/contacts/:id', () => {
  it('apaga e devolve 204', async () => {
    const created = await api<ContactDto>({
      method: 'POST',
      url: '/api/contacts',
      payload: { phone: '+258840006666' },
    });

    const { status } = await api({
      method: 'DELETE',
      url: `/api/contacts/${created.body.id}`,
    });

    expect(status).toBe(204);

    const after = await api({
      method: 'GET',
      url: `/api/contacts/${created.body.id}`,
    });
    expect(after.status).toBe(404);
  });

  it('guarda a auditoria antes de apagar, para o registo sobreviver', async () => {
    const result = await getPool().query(
      `SELECT id FROM audit_logs WHERE action = 'contact.deleted'`,
    );

    expect(result.rowCount).toBe(1);
  });

  it('devolve 404 ao apagar algo que não existe', async () => {
    const { status } = await api({
      method: 'DELETE',
      url: '/api/contacts/00000000-0000-4000-8000-000000000000',
    });

    expect(status).toBe(404);
  });
});
