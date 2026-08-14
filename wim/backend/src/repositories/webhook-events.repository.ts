/**
 * Repositório para webhook_events.
 *
 * A tabela webhook_events é a chave para idempotência: cada evento recebido
 * é registado aqui com seu external_id (ex: wamid.XXX do WhatsApp).
 *
 * Se o evento já existe, a função de processamento detecta-o e sai cedo.
 */
import { getPool, type Queryable } from '../database/pool.js';

export interface InsertWebhookEventInput {
  provider: 'WHATSAPP' | 'TELEGRAM' | 'SLACK'; // Preparado para múltiplos canais
  externalId: string; // ex: wamid.XXX
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  rawPayload?: unknown; // JSON da Meta
  errorMessage?: string;
}

export interface WebhookEventRow {
  id: string;
  provider: string;
  external_id: string;
  status: string;
  raw_payload: unknown;
  error_message: string | null;
  created_at: Date;
}

export async function findByExternalId(
  provider: string,
  externalId: string,
  queryable?: Queryable,
): Promise<WebhookEventRow | null> {
  const pool = queryable ?? getPool();

  const result = await pool.query<WebhookEventRow>(
    `SELECT * FROM webhook_events WHERE provider = $1 AND external_id = $2`,
    [provider, externalId],
  );

  return result.rows[0] ?? null;
}

export async function insert(
  input: InsertWebhookEventInput,
  queryable?: Queryable,
): Promise<WebhookEventRow> {
  const pool = queryable ?? getPool();

  const result = await pool.query<WebhookEventRow>(
    `INSERT INTO webhook_events
       (provider, external_id, status, raw_payload, error_message, created_at)
     VALUES ($1, $2, $3, $4, $5, now())
     RETURNING *`,
    [
      input.provider,
      input.externalId,
      input.status,
      input.rawPayload ? JSON.stringify(input.rawPayload) : null,
      input.errorMessage ?? null,
    ],
  );

  return result.rows[0]!;
}
