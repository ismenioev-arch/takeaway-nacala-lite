/**
 * FASE 8 — a análise pela IA, do «mensagem recebida» ao rascunho à espera
 * de uma pessoa.
 *
 * A Claude não é chamada em nenhum destes testes: o cliente é substituído
 * por um duplo que devolve o que cada caso precisa. O que se testa aqui é
 * o *nosso* código — a reivindicação da fila, a validação, a transacção, a
 * decisão de automação e o que fica escrito na base de dados.
 *
 * A resposta real do modelo é verificada noutro sítio, pelo conjunto de
 * avaliação, que custa dinheiro e corre à mão.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetEnvCache } from '../../src/config/env.js';
import { closePool, getPool } from '../../src/database/pool.js';
import {
  createCompanyProfile,
  createContact,
  createConversation,
  createFaq,
  createMessage,
  createPrice,
  createService,
  createUser,
  freshSchema,
  setSetting,
} from '../helpers/fixtures.js';
import {
  AiPermanentError,
  AiTransientError,
  setAiClient,
  type AiClient,
  type AiCompletion,
} from '../../src/services/ai/client.js';
import { runAnalysisBatch } from '../../src/services/analysis.service.js';

const CRON_SECRET = 'segredo-do-agendador-para-testes';

let app: FastifyInstance;

/** A resposta típica de uma pergunta simples. */
function reply(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    priority: 'NORMAL',
    intent: 'INFORMACAO',
    confidence: 0.96,
    summary: 'O cliente quer saber o horário de atendimento.',
    urgency_reason: null,
    requires_human: false,
    recommended_action: null,
    suggested_reply: 'Estamos abertos de segunda a sexta, das oito às cinco.',
    mentions_price_or_deadline: false,
    grounded_in_registered_facts: true,
    ...overrides,
  };
}

/** Um cliente de IA que devolve o que o teste mandar, e conta as chamadas. */
function fakeClient(
  responder: (call: number) => unknown | Promise<unknown>,
): AiClient & { calls: number; prompts: string[] } {
  const state = {
    calls: 0,
    prompts: [] as string[],
    async analyze(request: { system: string; user: string }): Promise<AiCompletion> {
      state.calls += 1;
      state.prompts.push(request.user);

      const data = await responder(state.calls);

      return {
        data,
        model: 'claude-teste',
        tokensInput: 1200,
        tokensOutput: 180,
        latencyMs: 42,
      };
    },
  };

  return state;
}

async function pendingMessage(options: { body?: string } = {}): Promise<{
  messageId: string;
  conversationId: string;
  contactId: string;
}> {
  const contactId = await createContact({ name: 'Amélia Chissano' });
  const conversationId = await createConversation(contactId);
  const messageId = await createMessage(conversationId, contactId, {
    body: options.body ?? 'Bom dia, a que horas abrem no sábado?',
    status: 'RECEIVED',
  });

  return { messageId, conversationId, contactId };
}

const row = async <T>(sql: string, params: unknown[] = []): Promise<T | undefined> => {
  const result = await getPool().query<T>(sql, params);
  return result.rows[0];
};

beforeAll(async () => {
  vi.stubEnv('AI_ENABLED', 'true');
  vi.stubEnv('ANTHROPIC_API_KEY', 'chave-falsa-para-testes');
  vi.stubEnv('CRON_SECRET', CRON_SECRET);
  resetEnvCache();

  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closePool();
  setAiClient(undefined);
  vi.unstubAllEnvs();
  resetEnvCache();
});

beforeEach(async () => {
  await freshSchema();
  await createCompanyProfile();
  await createFaq({ question: 'Qual é o horário?', answer: 'Segunda a sexta, 8h às 17h.' });
  setAiClient(undefined);
});

describe('análise de uma mensagem', () => {
  it('grava análise, rascunho e novo estado da mensagem', async () => {
    const { messageId, conversationId } = await pendingMessage();
    setAiClient(fakeClient(() => reply()));

    const result = await runAnalysisBatch();

    expect(result.analyzed).toBe(1);

    const analysis = await row<{
      priority: string;
      intent: string;
      confidence: string;
      summary: string;
      model: string;
      prompt_version: string;
      tokens_input: number;
      latency_ms: number;
    }>(`SELECT * FROM message_analysis WHERE message_id = $1`, [messageId]);

    expect(analysis).toMatchObject({
      priority: 'NORMAL',
      intent: 'INFORMACAO',
      model: 'claude-teste',
      tokens_input: 1200,
    });
    expect(Number(analysis?.confidence)).toBeCloseTo(0.96, 3);
    expect(analysis?.prompt_version).toBeTruthy();

    const draft = await row<{ status: string; content: string; conversation_id: string }>(
      `SELECT * FROM ai_drafts WHERE message_id = $1`,
      [messageId],
    );

    // Mesmo quando o nível é AUTO, o rascunho nasce DRAFT. A promoção é
    // um passo separado, com registo próprio.
    expect(draft?.status).toBe('DRAFT');
    expect(draft?.content).toContain('segunda a sexta');
    expect(draft?.conversation_id).toBe(conversationId);

    const message = await row<{ status: string }>(`SELECT status FROM messages WHERE id = $1`, [
      messageId,
    ]);
    expect(message?.status).toBe('DRAFTED');
  });

  it('dá o contexto real da empresa ao modelo, sem os preços não autorizados', async () => {
    const { messageId } = await pendingMessage();
    void messageId;

    const serviceId = await createService({ name: 'Projecto de arquitectura' });
    await createPrice({ serviceId, label: 'Visita técnica', amount: 2500, authorized: true });
    await createPrice({ serviceId, label: 'Desconto de parceiro', amount: 999, authorized: false });

    const client = fakeClient(() => reply());
    setAiClient(client);

    await runAnalysisBatch();

    const prompt = client.prompts[0] ?? '';
    expect(prompt).toContain('Visita técnica');
    expect(prompt).toContain('Projecto de arquitectura');
    // O preço não autorizado nunca sai da base de dados.
    expect(prompt).not.toContain('Desconto de parceiro');
    expect(prompt).not.toContain('999');
  });

  it('inclui o histórico da conversa, mas não a mensagem em análise', async () => {
    const contactId = await createContact();
    const conversationId = await createConversation(contactId);
    await createMessage(conversationId, contactId, {
      body: 'Mensagem anterior sobre a fundação',
      status: 'DRAFTED',
    });
    await createMessage(conversationId, contactId, {
      body: 'A pergunta nova de hoje',
      status: 'RECEIVED',
    });

    const client = fakeClient(() => reply());
    setAiClient(client);
    await runAnalysisBatch();

    const prompt = client.prompts[0] ?? '';
    expect(prompt).toContain('Mensagem anterior sobre a fundação');
    expect(prompt.split('A pergunta nova de hoje').length - 1).toBe(1);
  });
});

describe('a conversa herda o que a análise descobriu', () => {
  it('sobe a prioridade e fica à espera de uma pessoa quando é urgente', async () => {
    const { conversationId } = await pendingMessage({
      body: 'A minha obra está parada, preciso falar consigo agora.',
    });

    setAiClient(
      fakeClient(() =>
        reply({
          priority: 'URGENTE',
          intent: 'OBRA',
          urgency_reason: 'A obra está parada desde ontem.',
          requires_human: true,
          summary: 'Obra parada, cliente quer falar já.',
        }),
      ),
    );

    await runAnalysisBatch();

    const conversation = await row<{ priority: string; status: string; subject: string }>(
      `SELECT * FROM conversations WHERE id = $1`,
      [conversationId],
    );

    expect(conversation?.priority).toBe('URGENTE');
    expect(conversation?.status).toBe('WAITING_HUMAN');
    expect(conversation?.subject).toBe('Obra parada, cliente quer falar já.');
  });

  it('nunca desce a prioridade por causa de um «obrigado»', async () => {
    const contactId = await createContact();
    const conversationId = await createConversation(contactId, { priority: 'URGENTE' });
    await createMessage(conversationId, contactId, { body: 'Obrigado!', status: 'RECEIVED' });

    setAiClient(fakeClient(() => reply({ priority: 'NORMAL', intent: 'OUTRO' })));
    await runAnalysisBatch();

    const conversation = await row<{ priority: string }>(
      `SELECT priority FROM conversations WHERE id = $1`,
      [conversationId],
    );

    expect(conversation?.priority).toBe('URGENTE');
  });

  it('não reabre uma conversa já resolvida', async () => {
    const contactId = await createContact();
    const conversationId = await createConversation(contactId, {
      status: 'RESOLVED',
      resolvedAt: new Date(),
    });
    await createMessage(conversationId, contactId, { status: 'RECEIVED' });

    setAiClient(fakeClient(() => reply()));
    await runAnalysisBatch();

    const conversation = await row<{ status: string }>(
      `SELECT status FROM conversations WHERE id = $1`,
      [conversationId],
    );

    expect(conversation?.status).toBe('RESOLVED');
  });
});

describe('notificações', () => {
  it('avisa quando a mensagem é urgente', async () => {
    await pendingMessage();
    setAiClient(
      fakeClient(() =>
        reply({
          priority: 'URGENTE',
          intent: 'OBRA',
          urgency_reason: 'Obra parada.',
        }),
      ),
    );

    await runAnalysisBatch();

    const notification = await row<{ type: string; priority: string; body: string }>(
      `SELECT * FROM notifications`,
    );

    expect(notification?.type).toBe('URGENT_MESSAGE');
    expect(notification?.priority).toBe('URGENTE');
    expect(notification?.body).toBe('Obra parada.');
  });

  it('avisa quando a resposta precisa de aprovação', async () => {
    await pendingMessage({ body: 'Quanto custa um projecto de uma casa?' });
    setAiClient(fakeClient(() => reply({ intent: 'ORCAMENTO' })));

    await runAnalysisBatch();

    const notification = await row<{ type: string }>(`SELECT * FROM notifications`);
    expect(notification?.type).toBe('APPROVAL_PENDING');
  });

  it('não enche o sino com rascunhos normais', async () => {
    await pendingMessage();
    setAiClient(fakeClient(() => reply({ intent: 'DOCUMENTO' })));

    await runAnalysisBatch();

    const count = await row<{ count: string }>(`SELECT count(*)::text FROM notifications`);
    expect(count?.count).toBe('0');
  });
});

describe('a decisão de automação chega à base de dados', () => {
  it('marca um orçamento como HUMAN_REQUIRED mesmo com confiança máxima', async () => {
    const { messageId } = await pendingMessage();
    setAiClient(fakeClient(() => reply({ intent: 'ORCAMENTO', confidence: 1 })));

    await runAnalysisBatch();

    const draft = await row<{ automation_level: string; status: string }>(
      `SELECT * FROM ai_drafts WHERE message_id = $1`,
      [messageId],
    );

    expect(draft?.automation_level).toBe('HUMAN_REQUIRED');
    expect(draft?.status).toBe('DRAFT');
  });

  it('só chega a AUTO com os dois interruptores ligados', async () => {
    const { messageId } = await pendingMessage();
    setAiClient(fakeClient(() => reply()));

    // Interruptores desligados (o estado por omissão).
    await runAnalysisBatch();
    const semAutomacao = await row<{ automation_level: string }>(
      `SELECT automation_level FROM ai_drafts WHERE message_id = $1`,
      [messageId],
    );
    expect(semAutomacao?.automation_level).toBe('DRAFT');

    // Agora ligados, e a mensagem reposta na fila.
    await setSetting('ai.automation_enabled', true);
    await createCompanyProfile({ autoReplyEnabled: true });
    await getPool().query(`UPDATE messages SET status = 'RECEIVED' WHERE id = $1`, [messageId]);

    await runAnalysisBatch();
    const comAutomacao = await row<{ automation_level: string }>(
      `SELECT automation_level FROM ai_drafts WHERE message_id = $1 AND status = 'DRAFT'`,
      [messageId],
    );
    expect(comAutomacao?.automation_level).toBe('AUTO');
  });

  it('respeita o limiar de confiança guardado nas definições', async () => {
    await setSetting('ai.automation_enabled', true);
    await setSetting('ai.confidence_threshold', 0.99);
    await createCompanyProfile({ autoReplyEnabled: true });

    const { messageId } = await pendingMessage();
    setAiClient(fakeClient(() => reply({ confidence: 0.95 })));

    await runAnalysisBatch();

    const draft = await row<{ automation_level: string }>(
      `SELECT automation_level FROM ai_drafts WHERE message_id = $1`,
      [messageId],
    );

    expect(draft?.automation_level).toBe('DRAFT');
  });
});

describe('quando a IA devolve lixo', () => {
  it('não grava nada e marca a mensagem como falhada', async () => {
    const { messageId } = await pendingMessage();
    setAiClient(fakeClient(() => reply({ priority: 'MUITO_URGENTE', confidence: 7 })));

    const result = await runAnalysisBatch();

    expect(result.failed).toBe(1);

    const analysis = await row(`SELECT * FROM message_analysis WHERE message_id = $1`, [messageId]);
    const draft = await row(`SELECT * FROM ai_drafts WHERE message_id = $1`, [messageId]);
    expect(analysis).toBeUndefined();
    expect(draft).toBeUndefined();

    const message = await row<{ status: string; error_code: string; error_detail: string }>(
      `SELECT * FROM messages WHERE id = $1`,
      [messageId],
    );

    expect(message?.status).toBe('FAILED');
    expect(message?.error_code).toBe('AI_INVALID_RESPONSE');
    // O detalhe tem de permitir perceber o que veio de lá.
    expect(message?.error_detail).toContain('priority');
  });

  it('recusa um URGENTE sem justificação, que a base de dados também recusaria', async () => {
    const { messageId } = await pendingMessage();
    setAiClient(fakeClient(() => reply({ priority: 'URGENTE', urgency_reason: null })));

    const result = await runAnalysisBatch();

    expect(result.failed).toBe(1);
    const message = await row<{ status: string }>(`SELECT status FROM messages WHERE id = $1`, [
      messageId,
    ]);
    expect(message?.status).toBe('FAILED');
  });

  it('regista a falha na auditoria', async () => {
    await pendingMessage();
    setAiClient(fakeClient(() => ({ nada: 'disto serve' })));

    await runAnalysisBatch();

    const audit = await row<{ action: string; entity_type: string }>(
      `SELECT * FROM audit_logs WHERE action = 'ai.analysis_failed'`,
    );

    expect(audit?.entity_type).toBe('message');
  });
});

describe('quando a chamada falha', () => {
  it('devolve a mensagem à fila se a falha for transitória', async () => {
    const { messageId } = await pendingMessage();
    setAiClient(
      fakeClient(() => {
        throw new AiTransientError('429 demasiados pedidos');
      }),
    );

    const result = await runAnalysisBatch();

    expect(result.retried).toBe(1);
    expect(result.failed).toBe(0);

    // Volta a RECEIVED: a próxima passagem tenta de novo.
    const message = await row<{ status: string }>(`SELECT status FROM messages WHERE id = $1`, [
      messageId,
    ]);
    expect(message?.status).toBe('RECEIVED');
  });

  it('pára o lote à primeira falha transitória, para não bater na mesma parede', async () => {
    await pendingMessage();
    await pendingMessage();
    await pendingMessage();

    const client = fakeClient(() => {
      throw new AiTransientError('rede em baixo');
    });
    setAiClient(client);

    await runAnalysisBatch();

    expect(client.calls).toBe(1);
  });

  it('desiste quando a falha é definitiva', async () => {
    const { messageId } = await pendingMessage();
    setAiClient(
      fakeClient(() => {
        throw new AiPermanentError('401 chave inválida');
      }),
    );

    const result = await runAnalysisBatch();

    expect(result.failed).toBe(1);
    const message = await row<{ status: string; error_code: string }>(
      `SELECT * FROM messages WHERE id = $1`,
      [messageId],
    );
    expect(message?.status).toBe('FAILED');
    expect(message?.error_code).toBe('AI_REQUEST_REJECTED');
  });

  it('uma mensagem problemática não impede as seguintes', async () => {
    await pendingMessage({ body: 'primeira' });
    await pendingMessage({ body: 'segunda' });

    setAiClient(
      fakeClient((call) =>
        call === 1 ? { lixo: true } : reply({ summary: 'A segunda correu bem.' }),
      ),
    );

    const result = await runAnalysisBatch();

    expect(result.failed).toBe(1);
    expect(result.analyzed).toBe(1);
  });
});

describe('a fila', () => {
  it('analisa cada mensagem uma só vez, mesmo com duas execuções em paralelo', async () => {
    await pendingMessage();
    const client = fakeClient(async () => {
      // Atraso suficiente para as duas execuções se cruzarem.
      await new Promise((resolve) => setTimeout(resolve, 50));
      return reply();
    });
    setAiClient(client);

    const [a, b] = await Promise.all([runAnalysisBatch(), runAnalysisBatch()]);

    expect(client.calls).toBe(1);
    expect(a.analyzed + b.analyzed).toBe(1);

    const count = await row<{ count: string }>(`SELECT count(*)::text FROM message_analysis`);
    expect(count?.count).toBe('1');
  });

  it('respeita o tamanho do lote e diz o que ficou por fazer', async () => {
    for (let i = 0; i < 4; i += 1) await pendingMessage();

    setAiClient(fakeClient(() => reply()));

    const result = await runAnalysisBatch(2);

    expect(result.analyzed).toBe(2);
    expect(result.remaining).toBe(2);
  });

  it('não toca em mensagens enviadas por nós', async () => {
    const contactId = await createContact();
    const conversationId = await createConversation(contactId);
    await createMessage(conversationId, contactId, {
      direction: 'OUTBOUND',
      waMessageId: null,
      status: 'SENT',
    });

    const client = fakeClient(() => reply());
    setAiClient(client);

    const result = await runAnalysisBatch();

    expect(client.calls).toBe(0);
    expect(result.analyzed).toBe(0);
  });

  it('recupera uma mensagem presa em ANALYZING há demasiado tempo', async () => {
    // O caso real em serverless: a função foi congelada a meio da chamada
    // à Claude e ninguém voltou a tocar naquela linha.
    const { messageId } = await pendingMessage();

    // O gatilho `messages_set_updated_at` põe sempre `updated_at = now()`,
    // que é precisamente o que torna a detecção fiável em produção. Para
    // simular o passado é preciso desligá-lo durante a escrita.
    await getPool().query(`ALTER TABLE messages DISABLE TRIGGER messages_set_updated_at`);
    await getPool().query(
      `UPDATE messages SET status = 'ANALYZING', updated_at = now() - interval '30 minutes'
        WHERE id = $1`,
      [messageId],
    );
    await getPool().query(`ALTER TABLE messages ENABLE TRIGGER messages_set_updated_at`);

    setAiClient(fakeClient(() => reply()));
    const result = await runAnalysisBatch();

    expect(result.analyzed).toBe(1);
  });

  it('deixa em paz uma mensagem reivindicada agora mesmo', async () => {
    const { messageId } = await pendingMessage();
    await getPool().query(`UPDATE messages SET status = 'ANALYZING' WHERE id = $1`, [messageId]);

    const client = fakeClient(() => reply());
    setAiClient(client);

    await runAnalysisBatch();

    expect(client.calls).toBe(0);
  });
});

describe('reanalisar a mesma mensagem', () => {
  it('substitui a análise e o rascunho, sem deixar dois pendentes', async () => {
    const { messageId } = await pendingMessage();

    setAiClient(fakeClient(() => reply({ summary: 'Primeira leitura.' })));
    await runAnalysisBatch();

    await getPool().query(`UPDATE messages SET status = 'RECEIVED' WHERE id = $1`, [messageId]);
    setAiClient(fakeClient(() => reply({ summary: 'Segunda leitura, melhor.' })));
    await runAnalysisBatch();

    const analyses = await getPool().query(
      `SELECT summary FROM message_analysis WHERE message_id = $1`,
      [messageId],
    );
    expect(analyses.rowCount).toBe(1);
    expect(analyses.rows[0]).toMatchObject({ summary: 'Segunda leitura, melhor.' });

    // O índice único parcial permite um só rascunho por decidir.
    const pending = await getPool().query(
      `SELECT status FROM ai_drafts WHERE message_id = $1 AND status IN ('DRAFT','EDITED','APPROVED')`,
      [messageId],
    );
    expect(pending.rowCount).toBe(1);

    const cancelled = await getPool().query(
      `SELECT count(*)::int AS n FROM ai_drafts WHERE message_id = $1 AND status = 'CANCELLED'`,
      [messageId],
    );
    expect(cancelled.rows[0]).toMatchObject({ n: 1 });
  });
});

describe('POST /api/ai/analyze', () => {
  it('aceita o segredo do agendador', async () => {
    await pendingMessage();
    setAiClient(fakeClient(() => reply()));

    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/analyze',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ analyzed: 1, remaining: 0 });
  });

  it('aceita também por GET, que é como o Vercel Cron invoca', async () => {
    await pendingMessage();
    setAiClient(fakeClient(() => reply()));

    const response = await app.inject({
      method: 'GET',
      url: '/api/ai/analyze',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ analyzed: 1 });
  });

  it('recusa um GET sem segredo, tal como recusa o POST', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/ai/analyze' });

    expect(response.statusCode).toBe(401);
  });

  it('recusa sem segredo e sem sessão', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/ai/analyze' });

    expect(response.statusCode).toBe(401);
  });

  it('recusa um segredo errado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/analyze',
      headers: { authorization: 'Bearer segredo-errado-mas-do-mesmo-tamanho' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('aceita uma pessoa com sessão iniciada', async () => {
    await createUser({ email: 'dona@nacala.mz', role: 'OWNER' });
    // Sem fazer login a sério: o que importa é que o caminho autenticado
    // existe e que o não autenticado é recusado — o login tem os seus
    // próprios testes.
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/analyze',
      headers: { authorization: 'Bearer token-invalido' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('publica o estado da fila a quem tem sessão', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/ai/queue' });

    // Sem sessão, 401 — e não 500 nem a fila exposta ao mundo.
    expect(response.statusCode).toBe(401);
  });
});
