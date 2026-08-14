/**
 * Acesso a `messages`.
 *
 * O histórico de uma conversa traz, para cada mensagem, a análise da IA e o
 * rascunho activo — é o que a interface da conversa mostra em conjunto
 * (secção 11).
 */
import type { MessageWithContextRow } from '../dtos/message.dto.js';
import type { MessageDirection, MessageStatus, MessageType } from '../models/enums.js';
import { getPool, type Queryable } from '../database/pool.js';
import { Conditions, likePattern } from './query-builder.js';
import type { ListResult } from './contacts.repository.js';

const BASE_QUERY = `
  FROM messages m
  LEFT JOIN message_analysis ma ON ma.message_id = m.id
  LEFT JOIN LATERAL (
    SELECT d.id, d.content, d.edited_content, d.status, d.automation_level
      FROM ai_drafts d
     WHERE d.message_id = m.id
       AND d.status IN ('DRAFT', 'EDITED', 'APPROVED')
     ORDER BY d.created_at DESC
     LIMIT 1
  ) dr ON true
`;

const SELECTED_COLUMNS = `
  m.id, m.conversation_id, m.contact_id, m.direction, m.wa_message_id,
  m.type, m.body, m.caption, m.media_id, m.media_mime, m.status,
  m.wa_timestamp, m.error_code, m.error_detail, m.created_at,
  ma.priority           AS analysis_priority,
  ma.intent             AS analysis_intent,
  ma.confidence         AS analysis_confidence,
  ma.summary            AS analysis_summary,
  ma.urgency_reason     AS analysis_urgency_reason,
  ma.requires_human     AS analysis_requires_human,
  ma.recommended_action AS analysis_recommended_action,
  dr.id                 AS draft_id,
  dr.content            AS draft_content,
  dr.edited_content     AS draft_edited_content,
  dr.status             AS draft_status,
  dr.automation_level   AS draft_automation_level
`;

export interface ListMessagesFilters {
  conversationId?: string | undefined;
  contactId?: string | undefined;
  direction?: MessageDirection | undefined;
  status?: readonly MessageStatus[] | undefined;
  q?: string | undefined;
  page: number;
  pageSize: number;
  /** `asc` mostra a conversa por ordem cronológica, como num chat. */
  sortDirection: 'asc' | 'desc';
}

function buildFilters(filters: ListMessagesFilters): Conditions {
  const conditions = new Conditions();

  conditions.addIfDefined('m.conversation_id = ?', filters.conversationId);
  conditions.addIfDefined('m.contact_id = ?', filters.contactId);
  conditions.addIfDefined('m.direction = ?', filters.direction);
  conditions.addIfNotEmpty('m.status = ANY(?)', filters.status);

  if (filters.q) {
    conditions.add('m.body ILIKE ?', likePattern(filters.q));
  }

  return conditions;
}

export async function listMessages(
  filters: ListMessagesFilters,
  db: Queryable = getPool(),
): Promise<ListResult<MessageWithContextRow>> {
  const conditions = buildFilters(filters);
  const where = conditions.toWhere();
  const values = conditions.toValues();

  // A mesma base da consulta principal: `message_analysis` é 1 para 1 e o
  // LATERAL do rascunho traz no máximo uma linha, por isso as junções não
  // multiplicam registos e a contagem fica correcta.
  const totalResult = await db.query<{ total: string }>(
    `SELECT count(*) AS total ${BASE_QUERY} ${where}`,
    values,
  );
  const total = Number(totalResult.rows[0]?.total ?? 0);

  if (total === 0) return { rows: [], total: 0 };

  const direction = filters.sortDirection === 'asc' ? 'ASC' : 'DESC';
  const limitIndex = conditions.nextIndex;

  const rows = await db.query<MessageWithContextRow>(
    `SELECT ${SELECTED_COLUMNS}
       ${BASE_QUERY}
       ${where}
      ORDER BY m.wa_timestamp ${direction}, m.id ${direction}
      LIMIT $${limitIndex} OFFSET $${limitIndex + 1}`,
    [...values, filters.pageSize, (filters.page - 1) * filters.pageSize],
  );

  return { rows: rows.rows, total };
}

export async function findMessageById(
  id: string,
  db: Queryable = getPool(),
): Promise<MessageWithContextRow | null> {
  const result = await db.query<MessageWithContextRow>(
    `SELECT ${SELECTED_COLUMNS} ${BASE_QUERY} WHERE m.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** Marca as mensagens recebidas de uma conversa como lidas. */
export async function markConversationRead(
  conversationId: string,
  db: Queryable = getPool(),
): Promise<number> {
  const result = await db.query(
    `UPDATE conversations SET unread_count = 0 WHERE id = $1 AND unread_count > 0`,
    [conversationId],
  );
  return result.rowCount ?? 0;
}

export interface InsertMessageInput {
  conversationId: string;
  contactId: string;
  direction: MessageDirection;
  waMessageId: string | null;
  type: MessageType;
  body: string | null;
  caption?: string | null;
  mediaId?: string | null;
  mediaMime?: string | null;
  mediaSha256?: string | null;
  status: MessageStatus;
  sentByUserId?: string | null;
  waTimestamp: Date;
  errorCode?: string | null;
  errorDetail?: string | null;
  raw?: unknown;
}

export async function insertMessage(
  input: InsertMessageInput,
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(
    `INSERT INTO messages
       (conversation_id, contact_id, direction, wa_message_id, type, body,
        caption, media_id, media_mime, media_sha256, status, sent_by_user_id,
        wa_timestamp, error_code, error_detail, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      input.conversationId,
      input.contactId,
      input.direction,
      input.waMessageId ?? null,
      input.type,
      input.body ?? null,
      input.caption ?? null,
      input.mediaId ?? null,
      input.mediaMime ?? null,
      input.mediaSha256 ?? null,
      input.status,
      input.sentByUserId ?? null,
      input.waTimestamp,
      input.errorCode ?? null,
      input.errorDetail ?? null,
      input.raw ? JSON.stringify(input.raw) : null,
    ],
  );
}
