/**
 * `/api/conversations` — a central de conversas.
 *
 * Cobre os filtros da secção 12, os contadores da secção 9 e a área
 * «Precisa da Minha Atenção» da secção 10.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closePool, getPool } from '../../src/database/pool.js';
import type { Paginated } from '../../src/dtos/common.dto.js';
import type { AttentionItemDto, ConversationDto } from '../../src/dtos/conversation.dto.js';
import type { ConversationCounts } from '../../src/repositories/conversations.repository.js';
import {
  createAnalysis,
  createContact,
  createConversation,
  createDraft,
  createMessage,
  freshSchema,
  setConversationTimestamps,
} from '../helpers/fixtures.js';
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

/** Identificadores do cenário, para os testes se referirem a casos concretos. */
const scenario = {
  urgente: '',
  importante: '',
  acompanhar: '',
  normal: '',
  resolvida: '',
  comRascunho: '',
};

/**
 * Cenário realista: cinco conversas em estados diferentes, mais uma resolvida.
 * É montado uma vez e partilhado — os testes só leem.
 */
async function buildScenario(): Promise<void> {
  // 1. URGENTE, cliente à espera há 3 horas, com análise da IA
  {
    const contactId = await createContact({ name: 'João Macuácua' });
    const conversationId = await createConversation(contactId, {
      priority: 'URGENTE',
      status: 'WAITING_HUMAN',
    });
    const messageId = await createMessage(conversationId, contactId, {
      body: 'Minha obra está parada, preciso falar consigo agora.',
    });
    await createAnalysis(messageId, {
      priority: 'URGENTE',
      intent: 'OBRA',
      summary: 'Cliente com a obra parada precisa de contacto imediato.',
      urgencyReason: 'A obra está parada e há custos a correr.',
      requiresHuman: true,
      recommendedAction: 'Contactar imediatamente.',
    });
    await setConversationTimestamps(conversationId, {
      lastMessageAt: '2026-08-13T06:00:00Z',
      lastInboundAt: '2026-08-13T06:00:00Z',
      lastOutboundAt: null,
    });
    scenario.urgente = conversationId;
  }

  // 2. IMPORTANTE, pedido de orçamento, com rascunho por aprovar
  {
    const contactId = await createContact({ name: 'Ana Sitoe' });
    const conversationId = await createConversation(contactId, {
      priority: 'IMPORTANTE',
      status: 'OPEN',
    });
    const messageId = await createMessage(conversationId, contactId, {
      body: 'Quanto custa um projeto de uma casa?',
    });
    await createAnalysis(messageId, {
      priority: 'IMPORTANTE',
      intent: 'ORCAMENTO',
      summary: 'Cliente pede orçamento para projecto de moradia.',
      requiresHuman: true,
    });
    await createDraft(messageId, conversationId, { level: 'HUMAN_REQUIRED' });
    await setConversationTimestamps(conversationId, {
      lastMessageAt: '2026-08-13T07:00:00Z',
      lastInboundAt: '2026-08-13T07:00:00Z',
      lastOutboundAt: null,
    });
    scenario.importante = conversationId;
    scenario.comRascunho = conversationId;
  }

  // 3. ACOMPANHAR, já respondida — não está à espera de nós
  {
    const contactId = await createContact({ name: 'Carlos Bila' });
    const conversationId = await createConversation(contactId, {
      priority: 'ACOMPANHAR',
      status: 'WAITING_CUSTOMER',
    });
    const messageId = await createMessage(conversationId, contactId, {
      body: 'Vou pagar na próxima semana.',
    });
    await createAnalysis(messageId, { priority: 'ACOMPANHAR', intent: 'PAGAMENTO' });
    await setConversationTimestamps(conversationId, {
      lastMessageAt: '2026-08-13T08:00:00Z',
      lastInboundAt: '2026-08-12T08:00:00Z',
      lastOutboundAt: '2026-08-13T08:00:00Z',
    });
    scenario.acompanhar = conversationId;
  }

  // 4. NORMAL, pergunta simples já respondida
  {
    const contactId = await createContact({ name: 'Maria Chirindza' });
    const conversationId = await createConversation(contactId, {
      priority: 'NORMAL',
      status: 'OPEN',
    });
    const messageId = await createMessage(conversationId, contactId, {
      body: 'Qual é o horário de atendimento?',
    });
    await createAnalysis(messageId, { priority: 'NORMAL', intent: 'INFORMACAO' });
    await setConversationTimestamps(conversationId, {
      lastMessageAt: '2026-08-13T09:00:00Z',
      lastInboundAt: '2026-08-12T09:00:00Z',
      lastOutboundAt: '2026-08-13T09:00:00Z',
    });
    scenario.normal = conversationId;
  }

  // 5. Resolvida — fora do painel
  {
    const contactId = await createContact({ name: 'Pedro Nhaca' });
    const conversationId = await createConversation(contactId, { priority: 'NORMAL' });
    await createMessage(conversationId, contactId, { body: 'Obrigado pela ajuda.' });
    await getPool().query(
      `UPDATE conversations SET status = 'RESOLVED', resolved_at = now() WHERE id = $1`,
      [conversationId],
    );
    scenario.resolvida = conversationId;
  }
}

beforeAll(async () => {
  await freshSchema();
  await buildScenario();
  app = await startTestApp();
  api = (await authenticateAs(app, { role: 'OWNER' })).call;
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('GET /api/conversations', () => {
  it('devolve todas as conversas com contacto e análise embutidos', async () => {
    const { status, body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: '/api/conversations',
    });

    expect(status).toBe(200);
    expect(body.pagination.total).toBe(5);

    const urgente = body.data.find((c) => c.id === scenario.urgente);
    expect(urgente?.contact.name).toBe('João Macuácua');
    expect(urgente?.analysis.summary).toContain('obra parada');
    expect(urgente?.analysis.intent).toBe('OBRA');
    expect(urgente?.analysis.recommendedAction).toBe('Contactar imediatamente.');
    expect(urgente?.lastMessagePreview).toContain('obra está parada');
  });

  it('ordena por prioridade com as urgências primeiro, sem indicar o sentido', async () => {
    // Sem `sortDirection`, ordenar por prioridade tem de dar urgentes no topo.
    // "Descendente" ali poria as normais primeiro — o contrário do esperado.
    const { body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: `/api/conversations${query({ sortBy: 'priority', resolved: 'false' })}`,
    });

    expect(body.data.map((c) => c.priority)).toEqual([
      'URGENTE',
      'IMPORTANTE',
      'ACOMPANHAR',
      'NORMAL',
    ]);
  });

  it('filtra por prioridade', async () => {
    const { body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: `/api/conversations${query({ priority: ['URGENTE', 'IMPORTANTE'] })}`,
    });

    expect(body.data).toHaveLength(2);
  });

  it('filtra por estado', async () => {
    const { body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: `/api/conversations${query({ status: 'WAITING_HUMAN' })}`,
    });

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(scenario.urgente);
  });

  it('filtra por intenção detectada pela IA', async () => {
    const { body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: `/api/conversations${query({ intent: 'ORCAMENTO' })}`,
    });

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(scenario.importante);
  });

  it('filtra as não respondidas', async () => {
    const { body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: `/api/conversations${query({ unanswered: 'true' })}`,
    });

    const ids = body.data.map((c) => c.id);
    expect(ids).toContain(scenario.urgente);
    expect(ids).toContain(scenario.importante);
    expect(ids).not.toContain(scenario.acompanhar);
    expect(body.data.every((c) => c.awaitingReply)).toBe(true);
  });

  it('filtra as que aguardam aprovação', async () => {
    const { body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: `/api/conversations${query({ awaitingApproval: 'true' })}`,
    });

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(scenario.comRascunho);
    expect(body.data[0]?.pendingDrafts).toBe(1);
  });

  it('exclui resolvidas e arquivadas quando resolved=false', async () => {
    const { body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: `/api/conversations${query({ resolved: 'false' })}`,
    });

    expect(body.pagination.total).toBe(4);
    expect(body.data.map((c) => c.id)).not.toContain(scenario.resolvida);
  });

  it('mostra só as resolvidas quando resolved=true', async () => {
    const { body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: `/api/conversations${query({ resolved: 'true' })}`,
    });

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(scenario.resolvida);
  });

  it('filtra por contacto', async () => {
    const all = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: '/api/conversations',
    });
    const contactId = all.body.data[0]!.contact.id;

    const { body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: `/api/conversations${query({ contactId })}`,
    });

    expect(body.data.every((c) => c.contact.id === contactId)).toBe(true);
  });

  it('filtra por intervalo de datas', async () => {
    const { body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: `/api/conversations${query({
        dateFrom: '2026-08-13T06:30:00Z',
        dateTo: '2026-08-13T08:30:00Z',
      })}`,
    });

    const ids = body.data.map((c) => c.id);
    expect(ids).toContain(scenario.importante);
    expect(ids).toContain(scenario.acompanhar);
    expect(ids).not.toContain(scenario.urgente);
  });

  it('recusa um intervalo de datas invertido', async () => {
    const { status, body } = await api<ApiErrorBody>({
      method: 'GET',
      url: `/api/conversations${query({
        dateFrom: '2026-08-14T00:00:00Z',
        dateTo: '2026-08-13T00:00:00Z',
      })}`,
    });

    expect(status).toBe(400);
    expect(body.error.details?.[0]?.message).toContain('anterior ou igual');
  });

  it('pesquisa no texto das mensagens', async () => {
    const { body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: `/api/conversations${query({ q: 'horário' })}`,
    });

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(scenario.normal);
  });

  it('pesquisa pelo nome do contacto', async () => {
    const { body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: `/api/conversations${query({ q: 'macuácua' })}`,
    });

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(scenario.urgente);
  });

  it('combina vários filtros ao mesmo tempo', async () => {
    const { body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: `/api/conversations${query({
        resolved: 'false',
        unanswered: 'true',
        priority: 'URGENTE',
      })}`,
    });

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(scenario.urgente);
  });

  it('devolve lista vazia, e não erro, quando nada corresponde', async () => {
    const { status, body } = await api<Paginated<ConversationDto>>({
      method: 'GET',
      url: `/api/conversations${query({ q: 'xyzinexistente' })}`,
    });

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(0);
    expect(body.pagination.totalPages).toBe(0);
  });
});

describe('GET /api/conversations/counts (secção 9)', () => {
  it('devolve os cartões do painel', async () => {
    const { status, body } = await api<ConversationCounts>({
      method: 'GET',
      url: '/api/conversations/counts',
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      total: 4,
      urgente: 1,
      importante: 1,
      acompanhar: 1,
      normal: 1,
      unanswered: 2,
      awaitingApproval: 1,
      resolved: 1,
    });
  });

  it('não conta as resolvidas no total em aberto', async () => {
    const { body } = await api<ConversationCounts>({
      method: 'GET',
      url: '/api/conversations/counts',
    });

    expect(body.total).toBe(4);
    expect(body.resolved).toBe(1);
  });
});

describe('GET /api/conversations/attention (secção 10)', () => {
  it('coloca a urgência em primeiro lugar', async () => {
    const { status, body } = await api<{ data: AttentionItemDto[] }>({
      method: 'GET',
      url: '/api/conversations/attention',
    });

    expect(status).toBe(200);
    expect(body.data[0]?.conversationId).toBe(scenario.urgente);
    expect(body.data[0]?.priority).toBe('URGENTE');
  });

  it('devolve tudo o que o cartão da secção 10 precisa', async () => {
    const { body } = await api<{ data: AttentionItemDto[] }>({
      method: 'GET',
      url: '/api/conversations/attention',
    });

    const item = body.data[0]!;
    expect(item.contact.name).toBe('João Macuácua');
    expect(item.summary).toContain('obra parada');
    expect(item.urgencyReason).toContain('custos a correr');
    expect(item.recommendedAction).toBe('Contactar imediatamente.');
    expect(item.minutesSinceLastInbound).toBeGreaterThan(0);
    expect(item.awaitingReply).toBe(true);
  });

  it('exclui as resolvidas', async () => {
    const { body } = await api<{ data: AttentionItemDto[] }>({
      method: 'GET',
      url: '/api/conversations/attention',
    });

    expect(body.data.map((i) => i.conversationId)).not.toContain(scenario.resolvida);
  });

  it('inclui a que tem rascunho por aprovar', async () => {
    const { body } = await api<{ data: AttentionItemDto[] }>({
      method: 'GET',
      url: '/api/conversations/attention',
    });

    const item = body.data.find((i) => i.conversationId === scenario.comRascunho);
    expect(item?.pendingDrafts).toBe(1);
  });

  it('respeita o limite pedido', async () => {
    const { body } = await api<{ data: AttentionItemDto[] }>({
      method: 'GET',
      url: `/api/conversations/attention${query({ limit: 1 })}`,
    });

    expect(body.data).toHaveLength(1);
  });

  it('não confunde /attention com /:id', async () => {
    // Se o Fastify tratasse "attention" como um id, isto daria 400.
    const { status } = await api({
      method: 'GET',
      url: '/api/conversations/attention',
    });

    expect(status).toBe(200);
  });
});

describe('PATCH /api/conversations/:id', () => {
  it('altera a prioridade e regista a auditoria', async () => {
    const { status, body } = await api<ConversationDto>({
      method: 'PATCH',
      url: `/api/conversations/${scenario.normal}`,
      payload: { priority: 'IMPORTANTE', subject: 'Horários' },
    });

    expect(status).toBe(200);
    expect(body.priority).toBe('IMPORTANTE');
    expect(body.subject).toBe('Horários');

    const audit = await getPool().query<{ old_value: Record<string, unknown> }>(
      `SELECT old_value FROM audit_logs
        WHERE action = 'conversation.updated' AND entity_id = $1`,
      [scenario.normal],
    );

    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]!.old_value['priority']).toBe('NORMAL');
  });

  it('encaminha para o endpoint próprio em vez de resolver por PATCH', async () => {
    // Resolver por PATCH deixaria `resolved_at` por preencher e a constraint
    // da base de dados recusaria com um erro pouco claro.
    const { status, body } = await api<ApiErrorBody>({
      method: 'PATCH',
      url: `/api/conversations/${scenario.normal}`,
      payload: { status: 'RESOLVED' },
    });

    expect(status).toBe(400);
    expect(body.error.details?.[0]?.message).toContain('/resolve');
  });

  it('devolve 404 para uma conversa inexistente', async () => {
    const { status } = await api({
      method: 'PATCH',
      url: '/api/conversations/00000000-0000-4000-8000-000000000000',
      payload: { priority: 'NORMAL' },
    });

    expect(status).toBe(404);
  });
});

describe('POST /api/conversations/:id/resolve', () => {
  it('resolve, preenche a data e limpa as não lidas', async () => {
    const { status, body } = await api<ConversationDto>({
      method: 'POST',
      url: `/api/conversations/${scenario.acompanhar}/resolve`,
    });

    expect(status).toBe(200);
    expect(body.status).toBe('RESOLVED');
    expect(body.resolvedAt).not.toBeNull();
    expect(body.unreadCount).toBe(0);
  });

  it('recusa resolver duas vezes', async () => {
    const { status, body } = await api<ApiErrorBody>({
      method: 'POST',
      url: `/api/conversations/${scenario.acompanhar}/resolve`,
    });

    expect(status).toBe(409);
    expect(body.error.message).toContain('já está resolvida');
  });

  it('regista a resolução na auditoria', async () => {
    const result = await getPool().query(
      `SELECT id FROM audit_logs
        WHERE action = 'conversation.resolved' AND entity_id = $1`,
      [scenario.acompanhar],
    );

    expect(result.rowCount).toBe(1);
  });
});

describe('POST /api/conversations/:id/reopen', () => {
  it('reabre uma conversa resolvida', async () => {
    const { status, body } = await api<ConversationDto>({
      method: 'POST',
      url: `/api/conversations/${scenario.acompanhar}/reopen`,
    });

    expect(status).toBe(200);
    expect(body.status).toBe('OPEN');
    expect(body.resolvedAt).toBeNull();
  });

  it('recusa reabrir uma conversa que não está resolvida', async () => {
    const { status, body } = await api<ApiErrorBody>({
      method: 'POST',
      url: `/api/conversations/${scenario.urgente}/reopen`,
    });

    expect(status).toBe(409);
    expect(body.error.message).toContain('não está resolvida');
  });

  it('explica o conflito quando o contacto já tem outra conversa aberta', async () => {
    // A base de dados só permite uma conversa aberta por contacto. Sem esta
    // verificação, o utilizador veria um erro cru de índice único.
    const contactId = await createContact({ name: 'Cliente com duas conversas' });

    const antiga = await createConversation(contactId, { status: 'OPEN' });
    await getPool().query(
      `UPDATE conversations SET status = 'RESOLVED', resolved_at = now() WHERE id = $1`,
      [antiga],
    );
    await createConversation(contactId, { status: 'OPEN' });

    const { status, body } = await api<ApiErrorBody>({
      method: 'POST',
      url: `/api/conversations/${antiga}/reopen`,
    });

    expect(status).toBe(409);
    expect(body.error.message).toContain('já tem uma conversa aberta');
  });
});
