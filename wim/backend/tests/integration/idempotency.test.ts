/**
 * Idempotência (especificação, secção 16).
 *
 * «O sistema NÃO pode processar a mesma mensagem duas vezes.»
 *
 * A Meta reenvia o mesmo evento quando não recebe 200 depressa, e pode
 * reenviá-lo mais do que uma vez. A garantia não pode depender de o código se
 * lembrar de verificar: está no índice único de `messages.wa_message_id` e no
 * `UNIQUE (provider, external_id)` de `webhook_events`.
 *
 * Estes testes atacam a garantia por vários lados, incluindo em paralelo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../../src/database/pool.js';
import { createThread, freshSchema } from '../helpers/fixtures.js';

const WA_ID = 'wamid.HBgLMjU4ODQwMDAwMDEVAgASGBQzQTBBQjEyMzQ1Njc4OUFCQ0RFRgA=';

/** A inserção que o webhook usa: guarda, ou não faz nada se já existir. */
const INSERT_IF_NEW = `
  INSERT INTO messages (conversation_id, contact_id, direction, wa_message_id, body)
  VALUES ($1, $2, 'INBOUND', $3, $4)
  ON CONFLICT (wa_message_id) DO NOTHING
  RETURNING id
`;

describe('idempotência de mensagens', () => {
  let conversationId: string;
  let contactId: string;

  beforeAll(async () => {
    await freshSchema();
    const thread = await createThread();
    conversationId = thread.conversationId;
    contactId = thread.contactId;
  });

  afterAll(async () => {
    await closePool();
  });

  it('guarda a mensagem na primeira vez', async () => {
    const result = await getPool().query(INSERT_IF_NEW, [
      conversationId,
      contactId,
      WA_ID,
      'Minha obra está parada, preciso falar consigo agora.',
    ]);

    expect(result.rowCount).toBe(1);
  });

  it('não guarda nada na segunda vez, e não lança erro', async () => {
    const result = await getPool().query(INSERT_IF_NEW, [
      conversationId,
      contactId,
      WA_ID,
      'Minha obra está parada, preciso falar consigo agora.',
    ]);

    // rowCount 0 é o sinal que o webhook usa para parar sem processar.
    expect(result.rowCount).toBe(0);
  });

  it('continua a existir exactamente uma linha', async () => {
    const result = await getPool().query<{ count: string }>(
      `SELECT count(*) AS count FROM messages WHERE wa_message_id = $1`,
      [WA_ID],
    );

    expect(result.rows[0]!.count).toBe('1');
  });

  it('ignora o reenvio mesmo quando o conteúdo vem diferente', async () => {
    // Já aconteceu a fornecedores reenviarem o mesmo id com o payload alterado.
    // O id manda: não duplicamos.
    const result = await getPool().query(INSERT_IF_NEW, [
      conversationId,
      contactId,
      WA_ID,
      'TEXTO COMPLETAMENTE DIFERENTE',
    ]);

    expect(result.rowCount).toBe(0);

    const stored = await getPool().query<{ body: string }>(
      `SELECT body FROM messages WHERE wa_message_id = $1`,
      [WA_ID],
    );
    expect(stored.rows[0]!.body).toContain('obra está parada');
  });

  it('resiste a 10 entregas simultâneas do mesmo evento', async () => {
    // O caso que uma verificação em código (SELECT e depois INSERT) falharia:
    // dez ligações a inserir ao mesmo tempo. Só o índice único garante isto.
    const CONCURRENT_ID = 'wamid.CONCORRENTE';
    const pool = getPool();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        pool.query(INSERT_IF_NEW, [
          conversationId,
          contactId,
          CONCURRENT_ID,
          'Entrega simultânea',
        ]),
      ),
    );

    const inserted = results.filter((result) => result.rowCount === 1);
    expect(inserted).toHaveLength(1);

    const count = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM messages WHERE wa_message_id = $1`,
      [CONCURRENT_ID],
    );
    expect(count.rows[0]!.count).toBe('1');
  });

  it('recusa uma mensagem recebida sem identificador do WhatsApp', async () => {
    // Sem identificador não há como garantir idempotência, por isso a linha
    // não deve sequer entrar.
    await expect(
      getPool().query(
        `INSERT INTO messages (conversation_id, contact_id, direction, body)
         VALUES ($1, $2, 'INBOUND', 'sem identificador')`,
        [conversationId, contactId],
      ),
    ).rejects.toThrow(/messages_inbound_requires_wa_id/);
  });

  it('permite várias mensagens de saída ainda sem identificador', async () => {
    // Uma mensagem que ainda não foi entregue à Meta não tem id. Vários NULL
    // são permitidos num índice único — é o que torna isto possível.
    for (let i = 0; i < 3; i += 1) {
      const result = await getPool().query(
        `INSERT INTO messages (conversation_id, contact_id, direction, body, status)
         VALUES ($1, $2, 'OUTBOUND', $3, 'APPROVED')
         RETURNING id`,
        [conversationId, contactId, `Resposta pendente ${i}`],
      );
      expect(result.rowCount).toBe(1);
    }
  });
});

describe('idempotência de eventos do webhook', () => {
  const PAYLOAD = { object: 'whatsapp_business_account', entry: [{ id: '123' }] };

  it('aceita o primeiro evento', async () => {
    const result = await getPool().query(
      `INSERT INTO webhook_events (provider, external_id, payload, signature_valid)
       VALUES ('whatsapp', 'evt-001', $1::jsonb, true)
       ON CONFLICT (provider, external_id) DO NOTHING
       RETURNING id`,
      [JSON.stringify(PAYLOAD)],
    );

    expect(result.rowCount).toBe(1);
  });

  it('ignora o reenvio do mesmo evento', async () => {
    const result = await getPool().query(
      `INSERT INTO webhook_events (provider, external_id, payload, signature_valid)
       VALUES ('whatsapp', 'evt-001', $1::jsonb, true)
       ON CONFLICT (provider, external_id) DO NOTHING
       RETURNING id`,
      [JSON.stringify(PAYLOAD)],
    );

    expect(result.rowCount).toBe(0);
  });

  it('permite o mesmo identificador vindo de outro fornecedor', async () => {
    // A unicidade é por fornecedor: se um dia houver outro canal, os
    // identificadores não colidem.
    const result = await getPool().query(
      `INSERT INTO webhook_events (provider, external_id, payload, signature_valid)
       VALUES ('outro-canal', 'evt-001', '{}'::jsonb, true)
       ON CONFLICT (provider, external_id) DO NOTHING
       RETURNING id`,
    );

    expect(result.rowCount).toBe(1);
  });

  it('regista tentativas com assinatura inválida em vez de as apagar', async () => {
    // Uma assinatura inválida é sinal de abuso. Interessa poder vê-las.
    await getPool().query(
      `INSERT INTO webhook_events (provider, external_id, payload, signature_valid, status, error)
       VALUES ('whatsapp', 'evt-falso', '{}'::jsonb, false, 'FAILED', 'assinatura inválida')`,
    );

    const result = await getPool().query<{ count: string }>(
      `SELECT count(*) AS count FROM webhook_events WHERE NOT signature_valid`,
    );
    expect(result.rows[0]!.count).toBe('1');
  });

  it('exige um motivo quando o evento falha', async () => {
    await expect(
      getPool().query(
        `INSERT INTO webhook_events (provider, external_id, payload, signature_valid, status)
         VALUES ('whatsapp', 'evt-sem-motivo', '{}'::jsonb, true, 'FAILED')`,
      ),
    ).rejects.toThrow(/webhook_events_failed_requires_error/);
  });

  it('exige data de processamento quando o evento é dado como processado', async () => {
    await expect(
      getPool().query(
        `INSERT INTO webhook_events (provider, external_id, payload, signature_valid, status)
         VALUES ('whatsapp', 'evt-sem-data', '{}'::jsonb, true, 'PROCESSED')`,
      ),
    ).rejects.toThrow(/webhook_events_processed_has_timestamp/);
  });
});
