/**
 * Acesso a `ai_drafts` do lado de quem decide.
 *
 * As constraints da tabela são a espinha dorsal da regra de segurança do
 * sistema, e este ficheiro foi escrito a contar com elas: nenhuma função
 * aqui tenta contorná-las, e várias existem precisamente para lhes dar o
 * que elas exigem (o aprovador e a data juntos, a mensagem enviada ao
 * marcar `SENT`, o motivo ao marcar `FAILED`).
 */
import { getPool, type Queryable } from '../database/pool.js';
import type { AiDraftRow } from '../models/domain.js';

/** O rascunho com tudo o que é preciso para o mostrar e para o enviar. */
export interface DraftWithContextRow extends AiDraftRow {
  /** Para onde a resposta vai. */
  contact_wa_id: string;
  contact_id: string;
  contact_name: string | null;
  contact_phone: string;
  /** A mensagem do cliente que deu origem a isto. */
  inbound_body: string | null;
  inbound_type: string;
  inbound_timestamp: Date;
  conversation_priority: string;
  conversation_status: string;
  analysis_priority: string | null;
  analysis_intent: string | null;
  analysis_confidence: string | null;
  analysis_summary: string | null;
  analysis_urgency_reason: string | null;
  analysis_recommended_action: string | null;
}

const SELECT_WITH_CONTEXT = `
  SELECT d.*,
         ct.wa_id        AS contact_wa_id,
         ct.id           AS contact_id,
         coalesce(ct.display_name, ct.profile_name) AS contact_name,
         ct.phone_e164   AS contact_phone,
         m.body          AS inbound_body,
         m.type::text    AS inbound_type,
         m.wa_timestamp  AS inbound_timestamp,
         cv.priority::text AS conversation_priority,
         cv.status::text   AS conversation_status,
         a.priority::text  AS analysis_priority,
         a.intent::text    AS analysis_intent,
         a.confidence      AS analysis_confidence,
         a.summary         AS analysis_summary,
         a.urgency_reason  AS analysis_urgency_reason,
         a.recommended_action AS analysis_recommended_action
    FROM ai_drafts d
    JOIN messages m       ON m.id  = d.message_id
    JOIN conversations cv ON cv.id = d.conversation_id
    JOIN contacts ct      ON ct.id = m.contact_id
    LEFT JOIN message_analysis a ON a.message_id = d.message_id
`;

/**
 * Os rascunhos à espera de uma decisão, os mais graves primeiro.
 *
 * A ordem não é por data: é pela gravidade que a análise atribuiu. Numa
 * manhã com quarenta mensagens, o que interessa é que a obra parada
 * apareça antes do «bom dia».
 */
export async function listPendingDrafts(
  limit = 50,
  db: Queryable = getPool(),
): Promise<DraftWithContextRow[]> {
  const result = await db.query<DraftWithContextRow>(
    `${SELECT_WITH_CONTEXT}
      WHERE d.status IN ('DRAFT', 'EDITED')
      ORDER BY array_position(
                 ARRAY['URGENTE','IMPORTANTE','ACOMPANHAR','NORMAL']::message_priority[],
                 cv.priority),
               d.created_at
      LIMIT $1`,
    [limit],
  );

  return result.rows;
}

export async function findDraftById(
  id: string,
  db: Queryable = getPool(),
): Promise<DraftWithContextRow | null> {
  const result = await db.query<DraftWithContextRow>(`${SELECT_WITH_CONTEXT} WHERE d.id = $1`, [
    id,
  ]);

  return result.rows[0] ?? null;
}

/**
 * Tranca o rascunho para o resto da transacção.
 *
 * Duas pessoas no painel a carregar em ENVIAR ao mesmo tempo é um caso
 * real, não teórico. Sem o `FOR UPDATE`, as duas liam `DRAFT`, as duas
 * achavam que podiam, e o cliente recebia a mesma resposta duas vezes.
 */
export async function lockDraft(id: string, db: Queryable): Promise<AiDraftRow | null> {
  const result = await db.query<AiDraftRow>(`SELECT * FROM ai_drafts WHERE id = $1 FOR UPDATE`, [
    id,
  ]);

  return result.rows[0] ?? null;
}

/** Guarda a edição humana. O texto da IA nunca é alterado. */
export async function saveEdit(
  id: string,
  editedContent: string,
  db: Queryable = getPool(),
): Promise<AiDraftRow | null> {
  const result = await db.query<AiDraftRow>(
    `UPDATE ai_drafts SET status = 'EDITED', edited_content = $2
      WHERE id = $1 AND status IN ('DRAFT', 'EDITED')
      RETURNING *`,
    [id, editedContent],
  );

  return result.rows[0] ?? null;
}

export async function cancelDraft(
  id: string,
  db: Queryable = getPool(),
): Promise<AiDraftRow | null> {
  const result = await db.query<AiDraftRow>(
    `UPDATE ai_drafts SET status = 'CANCELLED'
      WHERE id = $1 AND status IN ('DRAFT', 'EDITED', 'APPROVED')
      RETURNING *`,
    [id],
  );

  return result.rows[0] ?? null;
}

/**
 * Marca a aprovação humana.
 *
 * O utilizador e a data vão juntos porque a constraint
 * `ai_drafts_approval_fields_together` não aceita de outra maneira — e
 * ainda bem: «aprovado por ninguém às tantas» não é uma aprovação.
 */
export async function approveDraft(
  id: string,
  userId: string,
  db: Queryable,
): Promise<AiDraftRow | null> {
  const result = await db.query<AiDraftRow>(
    `UPDATE ai_drafts
        SET status = 'APPROVED', approved_by_user_id = $2, approved_at = now()
      WHERE id = $1
      RETURNING *`,
    [id, userId],
  );

  return result.rows[0] ?? null;
}

export async function markDraftSent(
  id: string,
  sentMessageId: string,
  db: Queryable,
): Promise<void> {
  await db.query(`UPDATE ai_drafts SET status = 'SENT', sent_message_id = $2 WHERE id = $1`, [
    id,
    sentMessageId,
  ]);
}

export async function markDraftFailed(
  id: string,
  errorCode: string,
  errorDetail: string,
  db: Queryable,
): Promise<void> {
  await db.query(
    `UPDATE ai_drafts SET status = 'FAILED', error_code = $2, error_detail = $3 WHERE id = $1`,
    [id, errorCode, errorDetail.slice(0, 2000)],
  );
}

export async function countPendingDrafts(db: Queryable = getPool()): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ai_drafts WHERE status IN ('DRAFT', 'EDITED')`,
  );

  return Number(result.rows[0]?.count ?? 0);
}
