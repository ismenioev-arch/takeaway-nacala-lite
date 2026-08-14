/**
 * Acesso a `conversations`.
 *
 * A consulta principal junta, numa só ida à base de dados, tudo o que o painel
 * precisa para desenhar a lista: a conversa, o contacto, a última análise da
 * IA, o número de rascunhos por decidir e a última mensagem. Sem isto, uma
 * lista de 25 conversas custaria mais de cem consultas.
 */
import type { ConversationRow } from '../models/domain.js';
import type {
  ConversationStatus,
  Intent,
  Priority,
} from '../models/enums.js';
import type { ConversationListRow } from '../dtos/conversation.dto.js';
import { getPool, type Queryable } from '../database/pool.js';
import { Conditions, likePattern, resolveOrderBy } from './query-builder.js';
import type { ListResult } from './contacts.repository.js';

const SORT_COLUMNS = {
  lastMessageAt: 'c.last_message_at',
  priority: 'c.priority',
  createdAt: 'c.created_at',
} as const;

export type ConversationSortField = keyof typeof SORT_COLUMNS;

/**
 * Os `LEFT JOIN LATERAL` correm uma vez por conversa e devolvem no máximo uma
 * linha cada. É o que permite trazer «a análise mais recente» sem agrupar a
 * consulta inteira.
 */
const BASE_QUERY = `
  FROM conversations c
  JOIN contacts ct ON ct.id = c.contact_id
  LEFT JOIN LATERAL (
    SELECT ma.summary, ma.intent, ma.urgency_reason, ma.recommended_action
      FROM message_analysis ma
      JOIN messages m ON m.id = ma.message_id
     WHERE m.conversation_id = c.id
     ORDER BY m.wa_timestamp DESC, m.id DESC
     LIMIT 1
  ) la ON true
  LEFT JOIN LATERAL (
    SELECT m.body
      FROM messages m
     WHERE m.conversation_id = c.id
     ORDER BY m.wa_timestamp DESC, m.id DESC
     LIMIT 1
  ) lm ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS pending
      FROM ai_drafts d
     WHERE d.conversation_id = c.id
       AND d.status IN ('DRAFT', 'EDITED')
  ) pd ON true
`;

const SELECTED_COLUMNS = `
  c.id, c.contact_id, c.status, c.priority, c.subject,
  c.last_message_at, c.last_inbound_at, c.last_outbound_at,
  c.unread_count, c.resolved_at, c.created_at, c.updated_at,
  ct.display_name, ct.profile_name, ct.phone_e164, ct.company, ct.category,
  la.summary            AS latest_summary,
  la.intent             AS latest_intent,
  la.urgency_reason     AS latest_urgency_reason,
  la.recommended_action AS latest_recommended_action,
  coalesce(pd.pending, 0) AS pending_drafts,
  left(lm.body, 160)      AS last_message_preview
`;

export interface ListConversationsFilters {
  q?: string | undefined;
  status?: readonly ConversationStatus[] | undefined;
  priority?: readonly Priority[] | undefined;
  intent?: readonly Intent[] | undefined;
  contactId?: string | undefined;
  tagId?: string | undefined;
  unanswered?: boolean | undefined;
  awaitingApproval?: boolean | undefined;
  resolved?: boolean | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
  sortBy: ConversationSortField;
  sortDirection: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

/** Uma conversa está por responder quando o cliente falou por último. */
const UNANSWERED_SQL = `
  c.last_inbound_at IS NOT NULL
  AND (c.last_outbound_at IS NULL OR c.last_inbound_at > c.last_outbound_at)
`;

const HAS_PENDING_DRAFT_SQL = `
  EXISTS (
    SELECT 1 FROM ai_drafts d
     WHERE d.conversation_id = c.id AND d.status IN ('DRAFT', 'EDITED')
  )
`;

function buildFilters(filters: ListConversationsFilters): Conditions {
  const conditions = new Conditions();

  conditions.addIfNotEmpty('c.status = ANY(?)', filters.status);
  conditions.addIfNotEmpty('c.priority = ANY(?)', filters.priority);
  conditions.addIfNotEmpty('la.intent = ANY(?)', filters.intent);
  conditions.addIfDefined('c.contact_id = ?', filters.contactId);

  if (filters.tagId) {
    conditions.add(
      `EXISTS (SELECT 1 FROM conversation_tags ctg
                WHERE ctg.conversation_id = c.id AND ctg.tag_id = ?)`,
      filters.tagId,
    );
  }

  if (filters.unanswered === true) conditions.add(`(${UNANSWERED_SQL})`);
  if (filters.unanswered === false) conditions.add(`NOT (${UNANSWERED_SQL})`);

  if (filters.awaitingApproval === true) conditions.add(HAS_PENDING_DRAFT_SQL);
  if (filters.awaitingApproval === false) conditions.add(`NOT ${HAS_PENDING_DRAFT_SQL}`);

  // `resolved` é o separador do painel: falso significa "o que ainda está
  // em aberto", que inclui excluir também as arquivadas.
  if (filters.resolved === true) {
    conditions.add(`c.status IN ('RESOLVED', 'ARCHIVED')`);
  } else if (filters.resolved === false) {
    conditions.add(`c.status NOT IN ('RESOLVED', 'ARCHIVED')`);
  }

  conditions.addIfDefined('c.last_message_at >= ?', filters.dateFrom);
  conditions.addIfDefined('c.last_message_at <= ?', filters.dateTo);

  // A pesquisa cobre o contacto, o assunto, o resumo da IA e o texto das
  // mensagens — é o que a secção 30 pede como "pesquisa global".
  if (filters.q) {
    const term = likePattern(filters.q);
    conditions.add(
      `(
         ct.search_text ILIKE ?
         OR c.subject ILIKE ?
         OR la.summary ILIKE ?
         OR EXISTS (
              SELECT 1 FROM messages m
               WHERE m.conversation_id = c.id AND m.body ILIKE ?
            )
       )`,
      term,
      term,
      term,
      term,
    );
  }

  return conditions;
}

export async function listConversations(
  filters: ListConversationsFilters,
  db: Queryable = getPool(),
): Promise<ListResult<ConversationListRow>> {
  const conditions = buildFilters(filters);
  const where = conditions.toWhere();
  const values = conditions.toValues();

  const totalResult = await db.query<{ total: string }>(
    `SELECT count(*) AS total ${BASE_QUERY} ${where}`,
    values,
  );
  const total = Number(totalResult.rows[0]?.total ?? 0);

  if (total === 0) return { rows: [], total: 0 };

  const orderBy = resolveOrderBy(SORT_COLUMNS, filters.sortBy, filters.sortDirection);
  const limitIndex = conditions.nextIndex;

  const rows = await db.query<ConversationListRow>(
    `SELECT ${SELECTED_COLUMNS}
       ${BASE_QUERY}
       ${where}
      ORDER BY ${orderBy}, c.id
      LIMIT $${limitIndex} OFFSET $${limitIndex + 1}`,
    [...values, filters.pageSize, (filters.page - 1) * filters.pageSize],
  );

  return { rows: rows.rows, total };
}

/**
 * A área «Precisa da Minha Atenção» (secção 10).
 *
 * Ordem fixa e deliberada: prioridade primeiro (o enum já coloca URGENTE à
 * frente), e dentro da mesma prioridade a mais antiga sem resposta no topo —
 * quem está à espera há mais tempo aparece primeiro.
 */
export async function listAttention(
  limit: number,
  db: Queryable = getPool(),
): Promise<ConversationListRow[]> {
  const result = await db.query<ConversationListRow>(
    `SELECT ${SELECTED_COLUMNS}
       ${BASE_QUERY}
      WHERE c.status NOT IN ('RESOLVED', 'ARCHIVED')
        AND (
              ${UNANSWERED_SQL}
              OR ${HAS_PENDING_DRAFT_SQL}
              OR c.priority IN ('URGENTE', 'IMPORTANTE')
            )
      ORDER BY c.priority ASC, c.last_inbound_at ASC NULLS LAST, c.id
      LIMIT $1`,
    [limit],
  );

  return result.rows;
}

export async function findConversationById(
  id: string,
  db: Queryable = getPool(),
): Promise<ConversationListRow | null> {
  const result = await db.query<ConversationListRow>(
    `SELECT ${SELECTED_COLUMNS} ${BASE_QUERY} WHERE c.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** Versão crua, sem juntar nada. Usada quando só interessa o estado actual. */
export async function findConversationRow(
  id: string,
  db: Queryable = getPool(),
): Promise<ConversationRow | null> {
  const result = await db.query<ConversationRow>(
    `SELECT * FROM conversations WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export interface UpdateConversationData {
  status?: ConversationStatus;
  priority?: Priority;
  subject?: string | null;
}

const UPDATABLE_COLUMNS: Record<keyof UpdateConversationData, string> = {
  status: 'status',
  priority: 'priority',
  subject: 'subject',
};

export async function updateConversation(
  id: string,
  data: UpdateConversationData,
  db: Queryable = getPool(),
): Promise<ConversationRow | null> {
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const [field, column] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = data[field as keyof UpdateConversationData];
    if (value === undefined) continue;

    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }

  if (assignments.length === 0) {
    return findConversationRow(id, db);
  }

  values.push(id);

  const result = await db.query<ConversationRow>(
    `UPDATE conversations SET ${assignments.join(', ')}
      WHERE id = $${values.length}
      RETURNING *`,
    values,
  );

  return result.rows[0] ?? null;
}

/** Marca como resolvida, preenchendo a data que a constraint exige. */
export async function resolveConversation(
  id: string,
  userId: string | null,
  db: Queryable = getPool(),
): Promise<ConversationRow | null> {
  const result = await db.query<ConversationRow>(
    `UPDATE conversations
        SET status = 'RESOLVED', resolved_at = now(), resolved_by = $2, unread_count = 0
      WHERE id = $1
      RETURNING *`,
    [id, userId],
  );

  return result.rows[0] ?? null;
}

/** Reabre uma conversa resolvida, limpando a data de resolução. */
export async function reopenConversation(
  id: string,
  db: Queryable = getPool(),
): Promise<ConversationRow | null> {
  const result = await db.query<ConversationRow>(
    `UPDATE conversations
        SET status = 'OPEN', resolved_at = NULL, resolved_by = NULL
      WHERE id = $1
      RETURNING *`,
    [id],
  );

  return result.rows[0] ?? null;
}

/** Contagens por prioridade e estado, para os cartões do painel (secção 9). */
export interface ConversationCounts {
  total: number;
  urgente: number;
  importante: number;
  acompanhar: number;
  normal: number;
  unanswered: number;
  awaitingApproval: number;
  resolved: number;
}

export async function countConversations(
  db: Queryable = getPool(),
): Promise<ConversationCounts> {
  const result = await db.query<Record<string, string>>(
    `SELECT
       count(*) FILTER (WHERE c.status NOT IN ('RESOLVED','ARCHIVED'))                  AS total,
       count(*) FILTER (WHERE c.status NOT IN ('RESOLVED','ARCHIVED')
                          AND c.priority = 'URGENTE')                                   AS urgente,
       count(*) FILTER (WHERE c.status NOT IN ('RESOLVED','ARCHIVED')
                          AND c.priority = 'IMPORTANTE')                                AS importante,
       count(*) FILTER (WHERE c.status NOT IN ('RESOLVED','ARCHIVED')
                          AND c.priority = 'ACOMPANHAR')                                AS acompanhar,
       count(*) FILTER (WHERE c.status NOT IN ('RESOLVED','ARCHIVED')
                          AND c.priority = 'NORMAL')                                    AS normal,
       count(*) FILTER (WHERE c.status NOT IN ('RESOLVED','ARCHIVED')
                          AND ${UNANSWERED_SQL})                                        AS unanswered,
       count(*) FILTER (WHERE c.status NOT IN ('RESOLVED','ARCHIVED')
                          AND ${HAS_PENDING_DRAFT_SQL})                                 AS awaiting_approval,
       count(*) FILTER (WHERE c.status = 'RESOLVED')                                    AS resolved
     FROM conversations c`,
  );

  const row = result.rows[0] ?? {};
  const toNumber = (value: string | undefined): number => Number(value ?? 0);

  return {
    total: toNumber(row['total']),
    urgente: toNumber(row['urgente']),
    importante: toNumber(row['importante']),
    acompanhar: toNumber(row['acompanhar']),
    normal: toNumber(row['normal']),
    unanswered: toNumber(row['unanswered']),
    awaitingApproval: toNumber(row['awaiting_approval']),
    resolved: toNumber(row['resolved']),
  };
}

/**
 * Procura uma conversa aberta (não resolvida nem arquivada) para um contacto.
 *
 * Usado quando um webhook do WhatsApp chega: se já há uma conversa aberta,
 * a nova mensagem continua nela. Se não, criamos uma nova.
 */
export async function findOpenByContactId(
  contactId: string,
  queryable?: Queryable,
): Promise<ConversationRow | null> {
  const pool = queryable ?? getPool();

  const result = await pool.query<ConversationRow>(
    `SELECT * FROM conversations
     WHERE contact_id = $1
       AND status NOT IN ('RESOLVED', 'ARCHIVED')
     ORDER BY created_at DESC
     LIMIT 1`,
    [contactId],
  );

  return result.rows[0] ?? null;
}

/**
 * Incrementa o contador de mensagens não lidas de uma conversa.
 *
 * Usado ao receber uma mensagem inbound do WhatsApp.
 */
export async function incrementUnreadCount(
  conversationId: string,
  amount: number = 1,
  queryable?: Queryable,
): Promise<void> {
  const pool = queryable ?? getPool();

  await pool.query(
    `UPDATE conversations
     SET unread_count = unread_count + $1,
         last_inbound_at = now(),
         last_message_at = now(),
         updated_at = now()
     WHERE id = $2`,
    [amount, conversationId],
  );
}

export interface InsertConversationInput {
  contactId: string;
  status?: ConversationStatus;
  priority?: Priority;
  subject?: string | null;
}

export async function insertConversation(
  input: InsertConversationInput,
  db: Queryable = getPool(),
): Promise<ConversationRow> {
  const result = await db.query<ConversationRow>(
    `INSERT INTO conversations
       (contact_id, status, priority, subject)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      input.contactId,
      input.status ?? 'OPEN',
      input.priority ?? 'NORMAL',
      input.subject ?? null,
    ],
  );

  return result.rows[0]!;
}
