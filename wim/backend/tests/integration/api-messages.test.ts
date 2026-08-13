/**
 * `/api/messages` (secção 11) e `/api/search` (secção 30).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, getPool } from '../../src/database/pool.js';
import type { Paginated } from '../../src/dtos/common.dto.js';
import type { MessageDto, SearchResultDto } from '../../src/dtos/message.dto.js';
import {
  createAnalysis,
  createContact,
  createConversation,
  createDraft,
  createMessage,
  freshSchema,
} from '../helpers/fixtures.js';
import { call, query, startTestApp, type ApiErrorBody } from '../helpers/api.js';

let app: FastifyInstance;
let contactId: string;
let conversationId: string;
let inboundMessageId: string;

beforeAll(async () => {
  await freshSchema();

  contactId = await createContact({ name: 'João Macuácua' });
  conversationId = await createConversation(contactId, { priority: 'URGENTE' });

  inboundMessageId = await createMessage(conversationId, contactId, {
    body: 'Preciso mudar a fundação amanhã.',
  });
  await createAnalysis(inboundMessageId, {
    priority: 'URGENTE',
    intent: 'ALTERACAO_PROJETO',
    summary: 'Cliente precisa de alterar a planta antes do início da fundação.',
    urgencyReason: 'O cliente informou que a fundação começa amanhã.',
    requiresHuman: true,
    recommendedAction: 'Contactar o cliente imediatamente.',
    confidence: 0.94,
  });
  await createDraft(inboundMessageId, conversationId, {
    level: 'HUMAN_REQUIRED',
    content: 'Recebi a sua mensagem. Vou verificar a alteração e retorno.',
  });

  await createMessage(conversationId, contactId, {
    direction: 'OUTBOUND',
    waMessageId: 'wamid.RESPOSTA1',
    body: 'Bom dia, já estou a ver o assunto.',
    status: 'SENT',
  });

  await getPool().query(`UPDATE conversations SET unread_count = 3 WHERE id = $1`, [
    conversationId,
  ]);

  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('GET /api/messages', () => {
  it('devolve o histórico por ordem cronológica', async () => {
    const { status, body } = await call<Paginated<MessageDto>>(app, {
      method: 'GET',
      url: `/api/messages${query({ conversationId })}`,
    });

    expect(status).toBe(200);
    expect(body.data).toHaveLength(2);

    const timestamps = body.data.map((m) => m.timestamp);
    expect(timestamps).toEqual([...timestamps].sort());
  });

  it('traz a análise da IA junto da mensagem (secção 11)', async () => {
    const { body } = await call<Paginated<MessageDto>>(app, {
      method: 'GET',
      url: `/api/messages${query({ conversationId })}`,
    });

    const inbound = body.data.find((m) => m.id === inboundMessageId);

    expect(inbound?.analysis).toMatchObject({
      priority: 'URGENTE',
      intent: 'ALTERACAO_PROJETO',
      requiresHuman: true,
      recommendedAction: 'Contactar o cliente imediatamente.',
    });
    // `numeric` chega como string do driver; o DTO converte para número.
    expect(inbound?.analysis?.confidence).toBe(0.94);
  });

  it('traz o rascunho sugerido e marca-o como precisando de aprovação', async () => {
    const { body } = await call<Paginated<MessageDto>>(app, {
      method: 'GET',
      url: `/api/messages${query({ conversationId })}`,
    });

    const inbound = body.data.find((m) => m.id === inboundMessageId);

    expect(inbound?.draft?.automationLevel).toBe('HUMAN_REQUIRED');
    expect(inbound?.draft?.status).toBe('DRAFT');
    expect(inbound?.draft?.requiresApproval).toBe(true);
    // Sem edição, o texto efectivo é o da IA.
    expect(inbound?.draft?.effectiveContent).toBe(inbound?.draft?.content);
  });

  it('usa o texto editado quando existe', async () => {
    await getPool().query(
      `UPDATE ai_drafts SET status = 'EDITED', edited_content = $2 WHERE message_id = $1`,
      [inboundMessageId, 'Bom dia João, passo na obra amanhã às 09h00.'],
    );

    const { body } = await call<Paginated<MessageDto>>(app, {
      method: 'GET',
      url: `/api/messages${query({ conversationId })}`,
    });

    const inbound = body.data.find((m) => m.id === inboundMessageId);

    expect(inbound?.draft?.effectiveContent).toBe('Bom dia João, passo na obra amanhã às 09h00.');
    // O texto original da IA continua acessível para comparação.
    expect(inbound?.draft?.content).toContain('Vou verificar a alteração');
  });

  it('mensagens de saída não têm análise nem rascunho', async () => {
    const { body } = await call<Paginated<MessageDto>>(app, {
      method: 'GET',
      url: `/api/messages${query({ conversationId, direction: 'OUTBOUND' })}`,
    });

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.analysis).toBeNull();
    expect(body.data[0]?.draft).toBeNull();
  });

  it('filtra por direcção', async () => {
    const { body } = await call<Paginated<MessageDto>>(app, {
      method: 'GET',
      url: `/api/messages${query({ conversationId, direction: 'INBOUND' })}`,
    });

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.direction).toBe('INBOUND');
  });

  it('permite ordem inversa, para carregar o fim da conversa primeiro', async () => {
    const { body } = await call<Paginated<MessageDto>>(app, {
      method: 'GET',
      url: `/api/messages${query({ conversationId, sortDirection: 'desc' })}`,
    });

    const timestamps = body.data.map((m) => m.timestamp);
    expect(timestamps).toEqual([...timestamps].sort().reverse());
  });

  it('pesquisa no texto das mensagens', async () => {
    const { body } = await call<Paginated<MessageDto>>(app, {
      method: 'GET',
      url: `/api/messages${query({ q: 'fundação' })}`,
    });

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(inboundMessageId);
  });

  it('exige pelo menos um filtro', async () => {
    // Sem filtro devolveria mensagens de clientes misturados — nunca é o que
    // se pretende, e seria pesado.
    const { status, body } = await call<ApiErrorBody>(app, {
      method: 'GET',
      url: '/api/messages',
    });

    expect(status).toBe(400);
    expect(body.error.details?.[0]?.message).toContain('conversationId');
  });

  it('devolve 404 quando a conversa não existe', async () => {
    // 404 distingue "não existe" de "existe mas está vazia".
    const { status } = await call(app, {
      method: 'GET',
      url: `/api/messages${query({
        conversationId: '00000000-0000-4000-8000-000000000000',
      })}`,
    });

    expect(status).toBe(404);
  });
});

describe('GET /api/messages/:id', () => {
  it('devolve uma mensagem com o seu contexto', async () => {
    const { status, body } = await call<MessageDto>(app, {
      method: 'GET',
      url: `/api/messages/${inboundMessageId}`,
    });

    expect(status).toBe(200);
    expect(body.body).toBe('Preciso mudar a fundação amanhã.');
    expect(body.analysis?.priority).toBe('URGENTE');
  });

  it('devolve 404 para uma mensagem inexistente', async () => {
    const { status } = await call(app, {
      method: 'GET',
      url: '/api/messages/00000000-0000-4000-8000-000000000000',
    });

    expect(status).toBe(404);
  });
});

describe('POST /api/conversations/:id/read', () => {
  it('põe as não lidas a zero', async () => {
    const { status } = await call(app, {
      method: 'POST',
      url: `/api/conversations/${conversationId}/read`,
    });

    expect(status).toBe(204);

    const result = await getPool().query<{ unread_count: number }>(
      `SELECT unread_count FROM conversations WHERE id = $1`,
      [conversationId],
    );
    expect(result.rows[0]!.unread_count).toBe(0);
  });

  it('devolve 404 para uma conversa inexistente', async () => {
    const { status } = await call(app, {
      method: 'POST',
      url: '/api/conversations/00000000-0000-4000-8000-000000000000/read',
    });

    expect(status).toBe(404);
  });
});

describe('GET /api/search (secção 30)', () => {
  it('procura em contactos, conversas e mensagens ao mesmo tempo', async () => {
    const { status, body } = await call<SearchResultDto>(app, {
      method: 'GET',
      url: `/api/search${query({ q: 'macuácua' })}`,
    });

    expect(status).toBe(200);
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0]?.name).toBe('João Macuácua');
    expect(body.conversations).toHaveLength(1);
  });

  it('encontra por texto da mensagem e devolve o excerto com contexto', async () => {
    const { body } = await call<SearchResultDto>(app, {
      method: 'GET',
      url: `/api/search${query({ q: 'fundação' })}`,
    });

    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.excerpt).toContain('fundação');
    expect(body.messages[0]?.contactName).toBe('João Macuácua');
  });

  it('encontra por número de telefone', async () => {
    const contact = await getPool().query<{ phone_e164: string }>(
      `SELECT phone_e164 FROM contacts WHERE id = $1`,
      [contactId],
    );
    const digits = contact.rows[0]!.phone_e164.slice(-6);

    const { body } = await call<SearchResultDto>(app, {
      method: 'GET',
      url: `/api/search${query({ q: digits })}`,
    });

    expect(body.contacts).toHaveLength(1);
  });

  it('devolve listas vazias quando não encontra nada', async () => {
    const { status, body } = await call<SearchResultDto>(app, {
      method: 'GET',
      url: `/api/search${query({ q: 'zzzinexistente' })}`,
    });

    expect(status).toBe(200);
    expect(body).toEqual({ contacts: [], conversations: [], messages: [] });
  });

  it('exige um termo de pesquisa', async () => {
    const { status } = await call(app, { method: 'GET', url: '/api/search' });
    expect(status).toBe(400);
  });

  it('trata o texto de pesquisa como dados, não como padrão SQL', async () => {
    // Um '%' escrito pelo utilizador não pode transformar-se em curinga que
    // devolve tudo, nem quebrar a consulta.
    const { status, body } = await call<SearchResultDto>(app, {
      method: 'GET',
      url: `/api/search${query({ q: "%' OR '1'='1" })}`,
    });

    expect(status).toBe(200);
    expect(body.contacts).toEqual([]);
    expect(body.messages).toEqual([]);
  });
});
