/**
 * FASE 11 — aprovar, editar, cancelar e enviar.
 *
 * É a fase onde o sistema deixa de ser só de leitura e passa a poder
 * falar com clientes. Por isso os testes aqui estão menos interessados no
 * caminho feliz e mais nas maneiras de o estragar: enviar duas vezes,
 * enviar o que já foi cancelado, enviar sem pessoa identificada, e o que
 * fica para trás quando a Meta recusa.
 *
 * A Meta não é contactada em lado nenhum: o emissor é substituído por um
 * duplo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetEnvCache } from '../../src/config/env.js';
import { closePool, getPool } from '../../src/database/pool.js';
import {
  createAnalysis,
  createContact,
  createConversation,
  createDraft,
  createMessage,
  createUser,
  freshSchema,
} from '../helpers/fixtures.js';
import {
  SendPermanentError,
  SendTransientError,
  setMessageSender,
  type MessageSender,
} from '../../src/services/whatsapp-send.js';

let app: FastifyInstance;
let token: string;
let userId: string;

/** Um emissor que devolve o que o teste mandar, e conta as chamadas. */
function fakeSender(
  responder?: (call: number) => { waMessageId: string },
): MessageSender & { calls: number; sent: string[] } {
  const state = {
    calls: 0,
    sent: [] as string[],
    async sendText(input: { to: string; body: string }) {
      state.calls += 1;
      state.sent.push(input.body);
      return responder ? responder(state.calls) : { waMessageId: `wamid.ENVIADO${state.calls}` };
    },
  };

  return state;
}

/** Uma mensagem analisada, com rascunho à espera de decisão. */
async function pendingDraft(
  options: { level?: string; content?: string; priority?: string } = {},
): Promise<{ draftId: string; conversationId: string; messageId: string; contactId: string }> {
  const contactId = await createContact({ name: 'Amélia Mucavele' });
  const conversationId = await createConversation(contactId, {
    priority: options.priority ?? 'IMPORTANTE',
    status: 'WAITING_HUMAN',
  });
  const messageId = await createMessage(conversationId, contactId, {
    body: 'Queria encomendar 20 refeições para sexta-feira.',
    status: 'DRAFTED',
  });
  await createAnalysis(messageId, { priority: options.priority ?? 'IMPORTANTE' });
  const draftId = await createDraft(messageId, conversationId, {
    level: options.level ?? 'HUMAN_REQUIRED',
    content: options.content ?? 'Com certeza. A que horas precisa das refeições?',
  });

  return { draftId, conversationId, messageId, contactId };
}

const auth = () => ({ authorization: `Bearer ${token}` });

const row = async <T>(sql: string, params: unknown[] = []): Promise<T | undefined> => {
  const result = await getPool().query<T>(sql, params);
  return result.rows[0];
};

beforeAll(async () => {
  vi.stubEnv('WHATSAPP_ENABLED', 'true');
  vi.stubEnv('WHATSAPP_APP_SECRET', 'segredo-de-app-para-testes-1234567890');
  vi.stubEnv('WHATSAPP_VERIFY_TOKEN', 'token-de-verificacao-para-testes');
  vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'token-de-acesso-para-testes');
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '106540352242922');
  resetEnvCache();

  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closePool();
  setMessageSender(undefined);
  vi.unstubAllEnvs();
  resetEnvCache();
});

beforeEach(async () => {
  await freshSchema();
  setMessageSender(undefined);

  userId = await createUser({ email: 'dona@nacala.mz', role: 'OWNER' });
  // Sessão real: o envio exige um utilizador identificado, e é isso que
  // estes testes têm de exercitar.
  const { signAccessToken } = await import('../../src/auth/tokens.js');
  token = await signAccessToken(userId, 'OWNER');
});

describe('GET /api/drafts', () => {
  it('lista os rascunhos por decidir, com a mensagem e a análise', async () => {
    await pendingDraft();

    const response = await app.inject({ method: 'GET', url: '/api/drafts', headers: auth() });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      status: 'DRAFT',
      automationLevel: 'HUMAN_REQUIRED',
      requiresApproval: true,
    });
    // O cartão tem de poder mostrar as três coisas sem mais pedidos.
    expect(body.data[0].inbound.body).toContain('20 refeições');
    expect(body.data[0].analysis.summary).toBeTruthy();
    expect(body.data[0].contact.name).toBe('Amélia Mucavele');
    expect(body.canSend).toBe(true);
  });

  it('põe as conversas mais graves em primeiro lugar', async () => {
    await pendingDraft({ priority: 'NORMAL' });
    await pendingDraft({ priority: 'URGENTE' });
    await pendingDraft({ priority: 'ACOMPANHAR' });

    const response = await app.inject({ method: 'GET', url: '/api/drafts', headers: auth() });

    expect(response.json().data.map((d: { conversationPriority: string }) => d.conversationPriority))
      .toEqual(['URGENTE', 'ACOMPANHAR', 'NORMAL']);
  });

  it('não mostra o que já foi decidido', async () => {
    const { draftId } = await pendingDraft();
    await getPool().query(`UPDATE ai_drafts SET status = 'CANCELLED' WHERE id = $1`, [draftId]);

    const response = await app.inject({ method: 'GET', url: '/api/drafts', headers: auth() });

    expect(response.json().data).toHaveLength(0);
  });

  it('exige sessão', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/drafts' });

    expect(response.statusCode).toBe(401);
  });
});

describe('editar', () => {
  it('guarda a edição sem apagar o que a IA propôs', async () => {
    const { draftId } = await pendingDraft({ content: 'Texto original da IA.' });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/drafts/${draftId}`,
      headers: auth(),
      payload: { content: 'Texto escrito por uma pessoa.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'EDITED',
      content: 'Texto original da IA.',
      editedContent: 'Texto escrito por uma pessoa.',
      effectiveContent: 'Texto escrito por uma pessoa.',
    });
  });

  it('recusa uma resposta vazia', async () => {
    const { draftId } = await pendingDraft();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/drafts/${draftId}`,
      headers: auth(),
      payload: { content: '   ' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('regista quem editou, e o antes e o depois', async () => {
    const { draftId } = await pendingDraft({ content: 'Antes.' });

    await app.inject({
      method: 'PATCH',
      url: `/api/drafts/${draftId}`,
      headers: auth(),
      payload: { content: 'Depois.' },
    });

    const audit = await row<{ user_id: string; old_value: unknown; new_value: unknown }>(
      `SELECT * FROM audit_logs WHERE action = 'draft.edited'`,
    );

    expect(audit?.user_id).toBe(userId);
    expect(audit?.old_value).toMatchObject({ content: 'Antes.' });
    expect(audit?.new_value).toMatchObject({ content: 'Depois.' });
  });
});

describe('cancelar', () => {
  it('marca como cancelado e liberta a mensagem para novo rascunho', async () => {
    const { draftId, messageId } = await pendingDraft();

    const response = await app.inject({
      method: 'POST',
      url: `/api/drafts/${draftId}/cancel`,
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('CANCELLED');

    // O índice único parcial só conta os pendentes: com este cancelado,
    // é possível criar outro para a mesma mensagem.
    const novo = await createDraft(messageId, (await pendingDraftConversation(messageId))!, {
      content: 'Segunda tentativa.',
    });
    expect(novo).toBeTruthy();
  });

  it('não cancela duas vezes', async () => {
    const { draftId } = await pendingDraft();
    await app.inject({ method: 'POST', url: `/api/drafts/${draftId}/cancel`, headers: auth() });

    const segunda = await app.inject({
      method: 'POST',
      url: `/api/drafts/${draftId}/cancel`,
      headers: auth(),
    });

    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().error.message).toContain('cancelado');
  });
});

async function pendingDraftConversation(messageId: string): Promise<string | undefined> {
  const result = await getPool().query<{ conversation_id: string }>(
    `SELECT conversation_id FROM messages WHERE id = $1`,
    [messageId],
  );
  return result.rows[0]?.conversation_id;
}

describe('enviar', () => {
  it('aprova, envia e deixa tudo ligado', async () => {
    const { draftId, conversationId, messageId } = await pendingDraft();
    const sender = fakeSender();
    setMessageSender(sender);

    const response = await app.inject({
      method: 'POST',
      url: `/api/drafts/${draftId}/send`,
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'SENT', waMessageId: 'wamid.ENVIADO1' });
    expect(sender.calls).toBe(1);

    const draft = await row<{
      status: string;
      approved_by_user_id: string;
      approved_at: Date;
      sent_message_id: string;
    }>(`SELECT * FROM ai_drafts WHERE id = $1`, [draftId]);

    // As três constraints que importam, satisfeitas de verdade.
    expect(draft?.status).toBe('SENT');
    expect(draft?.approved_by_user_id).toBe(userId);
    expect(draft?.approved_at).toBeTruthy();
    expect(draft?.sent_message_id).toBeTruthy();

    const outbound = await row<{
      direction: string;
      status: string;
      wa_message_id: string;
      body: string;
      sent_by_user_id: string;
    }>(`SELECT * FROM messages WHERE direction = 'OUTBOUND'`);

    expect(outbound).toMatchObject({
      status: 'SENT',
      wa_message_id: 'wamid.ENVIADO1',
      sent_by_user_id: userId,
    });
    expect(outbound?.body).toContain('A que horas');

    // A conversa passou para o lado do cliente.
    const conversation = await row<{ status: string; unread_count: number; last_outbound_at: Date }>(
      `SELECT * FROM conversations WHERE id = $1`,
      [conversationId],
    );
    expect(conversation?.status).toBe('WAITING_CUSTOMER');
    expect(conversation?.unread_count).toBe(0);
    expect(conversation?.last_outbound_at).toBeTruthy();

    // A mensagem do cliente ficou fechada.
    const inbound = await row<{ status: string }>(`SELECT status FROM messages WHERE id = $1`, [
      messageId,
    ]);
    expect(inbound?.status).toBe('SENT');
  });

  it('envia o texto editado, e não o da IA', async () => {
    const { draftId } = await pendingDraft({ content: 'Texto da IA.' });
    const sender = fakeSender();
    setMessageSender(sender);

    await app.inject({
      method: 'PATCH',
      url: `/api/drafts/${draftId}`,
      headers: auth(),
      payload: { content: 'Texto da pessoa.' },
    });
    await app.inject({ method: 'POST', url: `/api/drafts/${draftId}/send`, headers: auth() });

    expect(sender.sent[0]).toBe('Texto da pessoa.');
  });

  it('aceita editar e enviar no mesmo gesto', async () => {
    const { draftId } = await pendingDraft({ content: 'Texto da IA.' });
    const sender = fakeSender();
    setMessageSender(sender);

    await app.inject({
      method: 'POST',
      url: `/api/drafts/${draftId}/send`,
      headers: auth(),
      payload: { content: 'Escrito à pressa antes de enviar.' },
    });

    expect(sender.sent[0]).toBe('Escrito à pressa antes de enviar.');

    // A edição fica registada; o texto da IA continua lá para comparação.
    const draft = await row<{ content: string; edited_content: string }>(
      `SELECT * FROM ai_drafts WHERE id = $1`,
      [draftId],
    );
    expect(draft?.content).toBe('Texto da IA.');
    expect(draft?.edited_content).toBe('Escrito à pressa antes de enviar.');
  });

  it('exige sessão — ninguém envia em nome de ninguém', async () => {
    const { draftId } = await pendingDraft();
    const sender = fakeSender();
    setMessageSender(sender);

    const response = await app.inject({ method: 'POST', url: `/api/drafts/${draftId}/send` });

    expect(response.statusCode).toBe(401);
    expect(sender.calls).toBe(0);
  });

  it('não envia duas vezes a mesma resposta', async () => {
    const { draftId } = await pendingDraft();
    const sender = fakeSender();
    setMessageSender(sender);

    const primeira = await app.inject({
      method: 'POST',
      url: `/api/drafts/${draftId}/send`,
      headers: auth(),
    });
    const segunda = await app.inject({
      method: 'POST',
      url: `/api/drafts/${draftId}/send`,
      headers: auth(),
    });

    expect(primeira.statusCode).toBe(200);
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().error.message).toContain('já foi enviada');
    expect(sender.calls).toBe(1);
  });

  it('aguenta dois cliques simultâneos sem enviar duas vezes', async () => {
    // O caso real: duas pessoas no painel, ou um duplo clique.
    const { draftId } = await pendingDraft();
    const sender = fakeSender();
    setMessageSender(sender);

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/drafts/${draftId}/send`, headers: auth() }),
      app.inject({ method: 'POST', url: `/api/drafts/${draftId}/send`, headers: auth() }),
    ]);

    const codigos = [a.statusCode, b.statusCode].sort();
    expect(codigos).toEqual([200, 409]);
    expect(sender.calls).toBe(1);

    const enviadas = await row<{ count: string }>(
      `SELECT count(*)::text AS count FROM messages WHERE direction = 'OUTBOUND'`,
    );
    expect(enviadas?.count).toBe('1');
  });

  it('não envia o que foi cancelado', async () => {
    const { draftId } = await pendingDraft();
    const sender = fakeSender();
    setMessageSender(sender);

    await app.inject({ method: 'POST', url: `/api/drafts/${draftId}/cancel`, headers: auth() });
    const response = await app.inject({
      method: 'POST',
      url: `/api/drafts/${draftId}/send`,
      headers: auth(),
    });

    expect(response.statusCode).toBe(409);
    expect(sender.calls).toBe(0);
  });
});

describe('quando a Meta recusa', () => {
  it('guarda a falha, avisa, e nada desaparece', async () => {
    const { draftId, conversationId } = await pendingDraft();
    setMessageSender({
      async sendText() {
        throw new SendPermanentError('Número inválido.', '131026');
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/drafts/${draftId}/send`,
      headers: auth(),
    });

    expect(response.statusCode).toBe(502);

    const draft = await row<{ status: string; error_code: string; error_detail: string }>(
      `SELECT * FROM ai_drafts WHERE id = $1`,
      [draftId],
    );
    expect(draft?.status).toBe('FAILED');
    expect(draft?.error_code).toBe('131026');

    // A mensagem de saída fica registada como falhada — não é apagada.
    const outbound = await row<{ status: string; error_code: string; wa_message_id: string | null }>(
      `SELECT * FROM messages WHERE direction = 'OUTBOUND'`,
    );
    expect(outbound?.status).toBe('FAILED');
    expect(outbound?.wa_message_id).toBeNull();

    const notification = await row<{ type: string; conversation_id: string }>(
      `SELECT * FROM notifications WHERE type = 'SEND_FAILED'`,
    );
    expect(notification?.conversation_id).toBe(conversationId);
  });

  it('distingue uma falha passageira de uma definitiva', async () => {
    const { draftId } = await pendingDraft();
    setMessageSender({
      async sendText() {
        throw new SendTransientError('429 demasiados pedidos');
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/drafts/${draftId}/send`,
      headers: auth(),
    });

    // 503 e não 502: a diferença é visível para quem está no painel.
    expect(response.statusCode).toBe(503);
    expect(response.json().error.message).toContain('tente de novo');
  });

  it('não deixa uma aprovação sem mensagem de saída', async () => {
    const { draftId } = await pendingDraft();
    setMessageSender({
      async sendText() {
        throw new SendPermanentError('qualquer coisa', 'X');
      },
    });

    await app.inject({ method: 'POST', url: `/api/drafts/${draftId}/send`, headers: auth() });

    // Mesmo tendo falhado, a aprovação ficou registada com o autor: é
    // quem respondeu por aquela decisão, independentemente do resultado.
    const draft = await row<{ approved_by_user_id: string }>(
      `SELECT * FROM ai_drafts WHERE id = $1`,
      [draftId],
    );
    expect(draft?.approved_by_user_id).toBe(userId);
  });
});

describe('a base de dados recusa o que o código não deve permitir', () => {
  it('não deixa aprovar sem utilizador, nem por SQL directo', async () => {
    const { draftId } = await pendingDraft();

    await expect(
      getPool().query(
        `UPDATE ai_drafts SET status = 'APPROVED', approved_at = now() WHERE id = $1`,
        [draftId],
      ),
    ).rejects.toThrow(/ai_drafts_approved_requires_human|approval_fields_together/);
  });

  it('não deixa marcar como enviado sem a mensagem que saiu', async () => {
    const { draftId } = await pendingDraft();

    await expect(
      getPool().query(`UPDATE ai_drafts SET status = 'SENT' WHERE id = $1`, [draftId]),
    ).rejects.toThrow(/ai_drafts_sent_requires_message|send_requires_human/);
  });
});

describe('com o WhatsApp desligado', () => {
  it('recusa enviar, mas não perde o rascunho', async () => {
    const { draftId } = await pendingDraft();
    vi.stubEnv('WHATSAPP_ENABLED', 'false');
    resetEnvCache();

    try {
      const response = await app.inject({
        method: 'POST',
        url: `/api/drafts/${draftId}/send`,
        headers: auth(),
      });

      expect(response.statusCode).toBe(503);

      const draft = await row<{ status: string }>(`SELECT * FROM ai_drafts WHERE id = $1`, [
        draftId,
      ]);
      expect(draft?.status).toBe('DRAFT');
    } finally {
      vi.stubEnv('WHATSAPP_ENABLED', 'true');
      resetEnvCache();
    }
  });
});
