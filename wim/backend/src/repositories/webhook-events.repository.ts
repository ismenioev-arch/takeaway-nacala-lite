/**
 * Repositório de `webhook_events` — a camada de idempotência do webhook.
 *
 * A Meta reenvia um evento até sete vezes se não receber 200 depressa. Sem
 * protecção, um cliente que escreveu uma vez apareceria sete vezes na
 * conversa.
 *
 * A protecção é o UNIQUE `(provider, external_id)` e um único comando SQL:
 * quem conseguir inserir a linha fica com o direito de processar o evento.
 * Não há «verificar e depois inserir» — entre as duas operações caberia um
 * segundo pedido, e com reenvios paralelos isso acontece mesmo.
 */
import { getPool, type Queryable } from '../database/pool.js';
import type { WebhookEventStatus } from '../models/enums.js';

export const WHATSAPP_PROVIDER = 'whatsapp';

/**
 * Durante quanto tempo um evento pode ficar em PENDING antes de outro
 * processo o poder reclamar.
 *
 * Existe porque um processo pode morrer a meio — numa função serverless,
 * basta esgotar o tempo. Sem isto, esse evento ficaria PENDING para sempre
 * e a mensagem do cliente nunca mais seria processada, porque todas as
 * tentativas seguintes seriam tratadas como duplicados.
 */
const STUCK_AFTER = '5 minutes';

export interface WebhookEventRow {
  id: string;
  provider: string;
  external_id: string;
  payload: unknown;
  signature_valid: boolean;
  status: WebhookEventStatus;
  error: string | null;
  received_at: Date;
  processed_at: Date | null;
}

export interface ClaimEventInput {
  externalId: string;
  payload: unknown;
  signatureValid: boolean;
  provider?: string;
}

/**
 * Tenta ficar responsável por processar um evento.
 *
 * Devolve o `id` da linha se o direito for nosso, ou `null` se o evento já
 * foi processado — ou está a ser processado agora mesmo por outro pedido.
 *
 * O `DO UPDATE ... WHERE` é o detalhe que faz isto funcionar nos dois
 * sentidos: evita duplicados, mas permite que uma tentativa falhada (ou
 * encravada) seja repetida. Um `DO NOTHING` simples seria mais curto e
 * transformaria qualquer falha temporária — a base de dados indisponível
 * por um segundo — na perda definitiva daquela mensagem.
 */
export async function claimEvent(
  input: ClaimEventInput,
  db: Queryable = getPool(),
): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO webhook_events (provider, external_id, payload, signature_valid, status)
     VALUES ($1, $2, $3, $4, 'PENDING')
     ON CONFLICT (provider, external_id) DO UPDATE
       SET payload         = EXCLUDED.payload,
           signature_valid = EXCLUDED.signature_valid,
           status          = 'PENDING',
           error           = NULL,
           received_at     = now()
     WHERE webhook_events.status = 'FAILED'
        OR (webhook_events.status = 'PENDING'
            AND webhook_events.received_at < now() - interval '${STUCK_AFTER}')
     RETURNING id`,
    [
      input.provider ?? WHATSAPP_PROVIDER,
      input.externalId,
      JSON.stringify(input.payload ?? null),
      input.signatureValid,
    ],
  );

  return result.rows[0]?.id ?? null;
}

/** O evento foi tratado até ao fim. */
export async function markProcessed(id: string, db: Queryable = getPool()): Promise<void> {
  await db.query(
    `UPDATE webhook_events
        SET status = 'PROCESSED', processed_at = now(), error = NULL
      WHERE id = $1`,
    [id],
  );
}

/**
 * O evento falhou. Fica registado com o motivo e pode ser reclamado de novo
 * — pela Meta, que vai reenviá-lo, ou por nós, numa reposição manual.
 */
export async function markFailed(
  id: string,
  error: string,
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(
    // A coluna `error` é obrigatória quando o estado é FAILED, e um texto
    // vazio contaria como ausente.
    `UPDATE webhook_events SET status = 'FAILED', error = $2 WHERE id = $1`,
    [id, error.trim() === '' ? 'Erro sem descrição.' : error.slice(0, 2000)],
  );
}

export async function findByExternalId(
  externalId: string,
  provider: string = WHATSAPP_PROVIDER,
  db: Queryable = getPool(),
): Promise<WebhookEventRow | null> {
  const result = await db.query<WebhookEventRow>(
    `SELECT * FROM webhook_events WHERE provider = $1 AND external_id = $2`,
    [provider, externalId],
  );

  return result.rows[0] ?? null;
}

/**
 * Regista uma tentativa com assinatura inválida.
 *
 * Não é um evento a processar — é um sinal de abuso, e a migração criou um
 * índice só para estas linhas serem fáceis de encontrar.
 */
export async function recordRejected(
  input: { externalId: string; payload: unknown; error: string; provider?: string },
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(
    `INSERT INTO webhook_events (provider, external_id, payload, signature_valid, status, error)
     VALUES ($1, $2, $3, false, 'FAILED', $4)
     ON CONFLICT (provider, external_id) DO NOTHING`,
    [
      input.provider ?? WHATSAPP_PROVIDER,
      input.externalId,
      JSON.stringify(input.payload ?? null),
      input.error.slice(0, 2000),
    ],
  );
}
