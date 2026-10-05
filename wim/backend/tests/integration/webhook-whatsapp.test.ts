/**
 * FASES 6 e 7 — recepção de mensagens do WhatsApp, do pedido HTTP até à
 * linha na base de dados.
 *
 * Estes testes usam payloads com a forma real da Meta e assinam-nos com
 * HMAC, como ela faz. Percorrem o caminho inteiro: assinatura, validação,
 * idempotência, transacção e escrita.
 *
 * Vários destes casos existem porque a implementação anterior falhava
 * exactamente neles — e nenhum dos erros dava sinal, porque o webhook
 * responde 200 mesmo quando nada foi guardado.
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resetEnvCache } from '../../src/config/env.js';
import { closePool, getPool } from '../../src/database/pool.js';
import { freshSchema, createContact, createConversation, createMessage } from '../helpers/fixtures.js';

const APP_SECRET = 'segredo-de-app-para-testes-1234567890';
const VERIFY_TOKEN = 'token-de-verificacao-para-testes';

let app: FastifyInstance;

/** Assina o corpo como a Meta assina: HMAC-SHA256 sobre os bytes exactos. */
function sign(body: string): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
}

/** Entrega um lote ao webhook, devidamente assinado. */
async function deliver(payload: unknown, options: { signature?: string } = {}) {
  const body = JSON.stringify(payload);

  return app.inject({
    method: 'POST',
    url: '/api/webhooks/whatsapp',
    payload: body,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': options.signature ?? sign(body),
    },
  });
}

/** Um lote com a forma que a Meta envia de verdade. */
function batch(options: {
  contacts?: Array<{ wa_id: string; name?: string }>;
  messages?: unknown[];
  statuses?: unknown[];
}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '258840000001',
                phone_number_id: '106540352242922',
              },
              ...(options.contacts && {
                contacts: options.contacts.map((c) => ({
                  wa_id: c.wa_id,
                  profile: { name: c.name ?? 'Cliente' },
                })),
              }),
              ...(options.messages && { messages: options.messages }),
              ...(options.statuses && { statuses: options.statuses }),
            },
          },
        ],
      },
    ],
  };
}

const textMessage = (id: string, from: string, body: string) => ({
  id,
  from,
  timestamp: '1700000000',
  type: 'text',
  text: { body },
});

beforeAll(async () => {
  vi.stubEnv('WHATSAPP_ENABLED', 'true');
  vi.stubEnv('WHATSAPP_APP_SECRET', APP_SECRET);
  vi.stubEnv('WHATSAPP_VERIFY_TOKEN', VERIFY_TOKEN);
  resetEnvCache();

  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closePool();
  vi.unstubAllEnvs();
  resetEnvCache();
});

beforeEach(async () => {
  await freshSchema();
});

describe('GET /api/webhooks/whatsapp — handshake', () => {
  it('devolve o desafio quando o token está correcto', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('1158201444');
  });

  it('recusa um token errado', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1',
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/webhooks/whatsapp — assinatura', () => {
  it('recusa um lote sem assinatura', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/whatsapp',
      payload: batch({ messages: [textMessage('wamid.1', '258840000000', 'olá')] }),
    });

    expect(response.statusCode).toBe(401);
  });

  it('recusa um lote com assinatura forjada', async () => {
    const response = await deliver(batch({ messages: [] }), { signature: `sha256=${'0'.repeat(64)}` });

    expect(response.statusCode).toBe(401);
  });
});

describe('recepção de mensagens', () => {
  it('cria contacto, conversa e mensagem a partir de um texto', async () => {
    const response = await deliver(
      batch({
        contacts: [{ wa_id: '258840000000', name: 'Amélia Mucavele' }],
        messages: [textMessage('wamid.HBgM1', '258840000000', 'Bom dia, ainda têm entrega?')],
      }),
    );

    expect(response.statusCode).toBe(200);

    const contact = await getPool().query(
      `SELECT wa_id, phone_e164, profile_name, category FROM contacts`,
    );
    expect(contact.rows).toHaveLength(1);
    expect(contact.rows[0]).toMatchObject({
      wa_id: '258840000000',
      // A Meta manda o número sem o «+»; a coluna é E.164.
      phone_e164: '+258840000000',
      profile_name: 'Amélia Mucavele',
      category: 'PROSPECT',
    });

    const message = await getPool().query(
      `SELECT direction, type, body, status, wa_message_id FROM messages`,
    );
    expect(message.rows).toHaveLength(1);
    expect(message.rows[0]).toMatchObject({
      direction: 'INBOUND',
      type: 'text',
      body: 'Bom dia, ainda têm entrega?',
      status: 'RECEIVED',
      wa_message_id: 'wamid.HBgM1',
    });

    const conversation = await getPool().query(
      `SELECT status, unread_count, last_inbound_at FROM conversations`,
    );
    expect(conversation.rows[0]).toMatchObject({ status: 'OPEN', unread_count: 1 });
    expect(conversation.rows[0]?.last_inbound_at).not.toBeNull();
  });

  it('guarda a hora que o WhatsApp indicou, e não a hora em que recebemos', async () => {
    await deliver(
      batch({
        contacts: [{ wa_id: '258840000000' }],
        messages: [
          { ...textMessage('wamid.T', '258840000000', 'enviada ontem'), timestamp: '1700000000' },
        ],
      }),
    );

    const result = await getPool().query<{ wa_timestamp: Date }>(`SELECT wa_timestamp FROM messages`);
    expect(result.rows[0]!.wa_timestamp.toISOString()).toBe(
      new Date(1_700_000_000_000).toISOString(),
    );
  });

  // O defeito mais grave da versão anterior: percorria contactos × mensagens
  // e atribuía as mensagens de um cliente ao outro.
  it('atribui cada mensagem a quem a enviou, num lote com vários clientes', async () => {
    await deliver(
      batch({
        contacts: [
          { wa_id: '258840000001', name: 'Primeiro' },
          { wa_id: '258840000002', name: 'Segundo' },
        ],
        messages: [
          textMessage('wamid.A', '258840000001', 'mensagem do primeiro'),
          textMessage('wamid.B', '258840000002', 'mensagem do segundo'),
          textMessage('wamid.C', '258840000001', 'outra do primeiro'),
        ],
      }),
    );

    const rows = await getPool().query<{ wa_id: string; body: string }>(
      `SELECT c.wa_id, m.body
         FROM messages m JOIN contacts c ON c.id = m.contact_id
        ORDER BY m.body`,
    );

    expect(rows.rows).toEqual([
      { wa_id: '258840000001', body: 'mensagem do primeiro' },
      { wa_id: '258840000002', body: 'mensagem do segundo' },
      { wa_id: '258840000001', body: 'outra do primeiro' },
    ]);

    // Três mensagens, dois contactos, duas conversas — e não seis de cada.
    const counts = await getPool().query<{ contacts: string; conversations: string }>(
      `SELECT (SELECT count(*) FROM contacts) AS contacts,
              (SELECT count(*) FROM conversations) AS conversations`,
    );
    expect(counts.rows[0]).toEqual({ contacts: '2', conversations: '2' });
  });

  it('acrescenta à conversa aberta em vez de criar uma nova', async () => {
    const lote = (id: string, texto: string) =>
      batch({
        contacts: [{ wa_id: '258840000000' }],
        messages: [textMessage(id, '258840000000', texto)],
      });

    await deliver(lote('wamid.1', 'primeira'));
    await deliver(lote('wamid.2', 'segunda'));

    const conversations = await getPool().query(`SELECT unread_count FROM conversations`);
    expect(conversations.rows).toHaveLength(1);
    expect(conversations.rows[0]).toMatchObject({ unread_count: 2 });

    const messages = await getPool().query(`SELECT count(*)::int AS total FROM messages`);
    expect(messages.rows[0]).toMatchObject({ total: 2 });
  });

  it('abre uma conversa nova quando a anterior já foi resolvida', async () => {
    const contactId = await createContact({ waId: '258840000000' });
    await createConversation(contactId, { status: 'RESOLVED', resolvedAt: new Date() });

    await deliver(
      batch({
        contacts: [{ wa_id: '258840000000' }],
        messages: [textMessage('wamid.NOVA', '258840000000', 'voltei')],
      }),
    );

    const result = await getPool().query<{ status: string }>(
      `SELECT status FROM conversations ORDER BY created_at`,
    );
    expect(result.rows.map((r) => r.status)).toEqual(['RESOLVED', 'OPEN']);
  });

  it('aceita uma mensagem sem o contacto na lista do lote', async () => {
    // Acontece: a Meta nem sempre repete o bloco `contacts`.
    await deliver(batch({ messages: [textMessage('wamid.X', '258849999999', 'olá')] }));

    const result = await getPool().query(`SELECT wa_id, profile_name FROM contacts`);
    expect(result.rows[0]).toMatchObject({ wa_id: '258849999999', profile_name: null });
  });
});

describe('idempotência', () => {
  // A Meta reenvia até sete vezes se não receber 200 depressa.
  it('não duplica quando o mesmo lote é entregue outra vez', async () => {
    const lote = batch({
      contacts: [{ wa_id: '258840000000' }],
      messages: [textMessage('wamid.REPETIDA', '258840000000', 'uma vez só')],
    });

    await deliver(lote);
    await deliver(lote);
    await deliver(lote);

    const messages = await getPool().query(`SELECT count(*)::int AS total FROM messages`);
    expect(messages.rows[0]).toMatchObject({ total: 1 });

    // E o contador de não lidas também não pode subir três vezes.
    const conversation = await getPool().query(`SELECT unread_count FROM conversations`);
    expect(conversation.rows[0]).toMatchObject({ unread_count: 1 });
  });

  it('processa só o que falta quando o reenvio traz mensagens novas', async () => {
    await deliver(
      batch({
        contacts: [{ wa_id: '258840000000' }],
        messages: [textMessage('wamid.1', '258840000000', 'primeira')],
      }),
    );

    await deliver(
      batch({
        contacts: [{ wa_id: '258840000000' }],
        messages: [
          textMessage('wamid.1', '258840000000', 'primeira'),
          textMessage('wamid.2', '258840000000', 'segunda'),
        ],
      }),
    );

    const result = await getPool().query<{ body: string }>(`SELECT body FROM messages ORDER BY body`);
    expect(result.rows.map((r) => r.body)).toEqual(['primeira', 'segunda']);
  });

  it('regista cada evento processado, para prova e diagnóstico', async () => {
    await deliver(
      batch({
        contacts: [{ wa_id: '258840000000' }],
        messages: [textMessage('wamid.AUDITADA', '258840000000', 'olá')],
      }),
    );

    const result = await getPool().query<{
      external_id: string;
      status: string;
      signature_valid: boolean;
      processed_at: Date | null;
    }>(`SELECT external_id, status, signature_valid, processed_at FROM webhook_events`);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      external_id: 'wamid.AUDITADA',
      status: 'PROCESSED',
      signature_valid: true,
    });
    expect(result.rows[0]?.processed_at).not.toBeNull();
  });
});

describe('tipos de mensagem', () => {
  it('guarda uma imagem com a referência da media', async () => {
    await deliver(
      batch({
        contacts: [{ wa_id: '258840000000' }],
        messages: [
          {
            id: 'wamid.IMG',
            from: '258840000000',
            timestamp: '1700000000',
            type: 'image',
            image: { id: 'media-123', mime_type: 'image/jpeg', sha256: 'abc', caption: 'este prato' },
          },
        ],
      }),
    );

    const result = await getPool().query(`SELECT type, body, caption, media_id, media_mime FROM messages`);
    expect(result.rows[0]).toMatchObject({
      type: 'image',
      body: 'este prato',
      caption: 'este prato',
      media_id: 'media-123',
      media_mime: 'image/jpeg',
    });
  });

  // Antes, um tipo desconhecido fazia a validação recusar o lote inteiro —
  // e as mensagens legítimas que vinham com ele desapareciam.
  it('um tipo desconhecido não leva atrás as mensagens boas do mesmo lote', async () => {
    await deliver(
      batch({
        contacts: [{ wa_id: '258840000000' }],
        messages: [
          { id: 'wamid.ESTRANHA', from: '258840000000', timestamp: '1700000000', type: 'ordem_v9' },
          textMessage('wamid.BOA', '258840000000', 'esta tem de passar'),
        ],
      }),
    );

    const result = await getPool().query<{ type: string; body: string }>(
      `SELECT type, body FROM messages ORDER BY wa_message_id`,
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ type: 'text', body: 'esta tem de passar' });
    expect(result.rows[1]!.type).toBe('unsupported');
    expect(result.rows[1]!.body).toContain('ordem_v9');
  });

  it('guarda uma localização de forma legível', async () => {
    await deliver(
      batch({
        contacts: [{ wa_id: '258840000000' }],
        messages: [
          {
            id: 'wamid.LOC',
            from: '258840000000',
            timestamp: '1700000000',
            type: 'location',
            location: { latitude: -14.5428, longitude: 40.6728, name: 'Bairro Triângulo' },
          },
        ],
      }),
    );

    const result = await getPool().query<{ type: string; body: string }>(
      `SELECT type, body FROM messages`,
    );
    expect(result.rows[0]!.type).toBe('location');
    expect(result.rows[0]!.body).toContain('Bairro Triângulo');
  });
});

describe('estados de entrega das nossas mensagens', () => {
  async function outboundMessage(waMessageId: string, status = 'SENT') {
    const contactId = await createContact({ waId: '258840000000' });
    const conversationId = await createConversation(contactId);
    await createMessage(conversationId, contactId, {
      direction: 'OUTBOUND',
      waMessageId,
      status,
    });
  }

  it('avança de enviada para entregue e depois para lida', async () => {
    await outboundMessage('wamid.SAIDA');

    for (const status of ['delivered', 'read']) {
      await deliver(
        batch({
          statuses: [
            { id: 'wamid.SAIDA', status, timestamp: '1700000000', recipient_id: '258840000000' },
          ],
        }),
      );
    }

    const result = await getPool().query<{ status: string }>(
      `SELECT status FROM messages WHERE wa_message_id = 'wamid.SAIDA'`,
    );
    expect(result.rows[0]).toMatchObject({ status: 'READ' });
  });

  // A Meta não garante a ordem. Sem protecção, o `delivered` que chega
  // atrasado faria uma mensagem já lida voltar a «entregue».
  it('não recua quando as notificações chegam fora de ordem', async () => {
    await outboundMessage('wamid.ORDEM', 'READ');

    await deliver(
      batch({ statuses: [{ id: 'wamid.ORDEM', status: 'delivered', timestamp: '1700000000' }] }),
    );

    const result = await getPool().query<{ status: string }>(
      `SELECT status FROM messages WHERE wa_message_id = 'wamid.ORDEM'`,
    );
    expect(result.rows[0]).toMatchObject({ status: 'READ' });
  });

  it('regista a falha com o motivo que a Meta deu', async () => {
    await outboundMessage('wamid.FALHOU');

    await deliver(
      batch({
        statuses: [
          {
            id: 'wamid.FALHOU',
            status: 'failed',
            timestamp: '1700000000',
            errors: [{ code: 131026, title: 'Message undeliverable' }],
          },
        ],
      }),
    );

    const result = await getPool().query<{ status: string; error_code: string; error_detail: string }>(
      `SELECT status, error_code, error_detail FROM messages WHERE wa_message_id = 'wamid.FALHOU'`,
    );
    expect(result.rows[0]).toMatchObject({
      status: 'FAILED',
      error_code: '131026',
      error_detail: 'Message undeliverable',
    });
  });

  it('ignora estados que não nos dizem nada', async () => {
    await outboundMessage('wamid.ACEITE');

    await deliver(batch({ statuses: [{ id: 'wamid.ACEITE', status: 'accepted' }] }));

    const events = await getPool().query(`SELECT count(*)::int AS total FROM webhook_events`);
    expect(events.rows[0]).toMatchObject({ total: 0 });
  });
});

describe('payloads que não entendemos', () => {
  it('responde 200 e não guarda nada quando a forma é inesperada', async () => {
    const response = await deliver({ isto: 'não é um webhook da Meta' });

    expect(response.statusCode).toBe(200);

    const messages = await getPool().query(`SELECT count(*)::int AS total FROM messages`);
    expect(messages.rows[0]).toMatchObject({ total: 0 });
  });

  it('ignora alterações de campos que não são mensagens', async () => {
    const response = await deliver({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '1',
          changes: [
            {
              field: 'message_template_status_update',
              value: { event: 'APPROVED', message_template_id: 1 },
            },
          ],
        },
      ],
    });

    expect(response.statusCode).toBe(200);
    const messages = await getPool().query(`SELECT count(*)::int AS total FROM messages`);
    expect(messages.rows[0]).toMatchObject({ total: 0 });
  });
});
