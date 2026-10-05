/**
 * Acesso a `message_analysis`, `ai_drafts` e `notifications`.
 *
 * Os três ficam juntos porque são escritos na mesma transacção: uma
 * análise sem rascunho é trabalho perdido, e um rascunho sem a análise que
 * o justifica é uma sugestão sem explicação. Ou entram os dois, ou não
 * entra nenhum.
 */
import { getPool, type Queryable } from '../database/pool.js';
import type { AiDraftRow, MessageAnalysisRow } from '../models/domain.js';
import type { AutomationLevel, Intent, NotificationType, Priority } from '../models/enums.js';

export interface UpsertAnalysisInput {
  messageId: string;
  priority: Priority;
  intent: Intent;
  confidence: number;
  summary: string;
  urgencyReason: string | null;
  requiresHuman: boolean;
  recommendedAction: string | null;
  model: string;
  promptVersion: string;
  tokensInput: number | null;
  tokensOutput: number | null;
  latencyMs: number | null;
  rawResponse: unknown;
}

/**
 * Grava a análise. Reanalisar a mesma mensagem substitui a análise anterior.
 *
 * O `ON CONFLICT (message_id) DO UPDATE` vem da coluna `UNIQUE` do esquema,
 * que decidiu esta política: uma mensagem tem uma leitura actual, não um
 * histórico de leituras. Quem quiser auditar o que mudou tem o
 * `raw_response` e o `prompt_version` de cada versão no registo de
 * auditoria.
 */
export async function upsertAnalysis(
  input: UpsertAnalysisInput,
  db: Queryable = getPool(),
): Promise<MessageAnalysisRow> {
  const result = await db.query<MessageAnalysisRow>(
    `INSERT INTO message_analysis
       (message_id, priority, intent, confidence, summary, urgency_reason,
        requires_human, recommended_action, model, prompt_version,
        tokens_input, tokens_output, latency_ms, raw_response)
     VALUES ($1, $2::message_priority, $3::message_intent, $4, $5, $6,
             $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (message_id) DO UPDATE SET
       priority           = EXCLUDED.priority,
       intent             = EXCLUDED.intent,
       confidence         = EXCLUDED.confidence,
       summary            = EXCLUDED.summary,
       urgency_reason     = EXCLUDED.urgency_reason,
       requires_human     = EXCLUDED.requires_human,
       recommended_action = EXCLUDED.recommended_action,
       model              = EXCLUDED.model,
       prompt_version     = EXCLUDED.prompt_version,
       tokens_input       = EXCLUDED.tokens_input,
       tokens_output      = EXCLUDED.tokens_output,
       latency_ms         = EXCLUDED.latency_ms,
       raw_response       = EXCLUDED.raw_response,
       created_at         = now()
     RETURNING *`,
    [
      input.messageId,
      input.priority,
      input.intent,
      input.confidence,
      input.summary,
      input.urgencyReason,
      input.requiresHuman,
      input.recommendedAction,
      input.model,
      input.promptVersion,
      input.tokensInput,
      input.tokensOutput,
      input.latencyMs,
      input.rawResponse === undefined ? null : JSON.stringify(input.rawResponse),
    ],
  );

  return result.rows[0]!;
}

export async function findAnalysisByMessageId(
  messageId: string,
  db: Queryable = getPool(),
): Promise<MessageAnalysisRow | null> {
  const result = await db.query<MessageAnalysisRow>(
    `SELECT * FROM message_analysis WHERE message_id = $1`,
    [messageId],
  );

  return result.rows[0] ?? null;
}

/**
 * Cancela os rascunhos por decidir de uma mensagem.
 *
 * Chamado antes de criar um novo, por causa do índice único parcial que
 * permite apenas um rascunho pendente por mensagem. Sem isto, reanalisar
 * uma mensagem rebentaria com violação de unicidade — ou, pior, deixaria o
 * utilizador a ver duas sugestões concorrentes.
 */
export async function cancelPendingDrafts(
  messageId: string,
  db: Queryable = getPool(),
): Promise<number> {
  const result = await db.query(
    `UPDATE ai_drafts
        SET status = 'CANCELLED'
      WHERE message_id = $1
        AND status IN ('DRAFT', 'EDITED', 'APPROVED')`,
    [messageId],
  );

  return result.rowCount ?? 0;
}

export interface InsertDraftInput {
  messageId: string;
  conversationId: string;
  automationLevel: AutomationLevel;
  content: string;
}

/**
 * Cria o rascunho. **Sempre com `status = 'DRAFT'`.**
 *
 * Mesmo quando o nível é AUTO. A promoção para enviado é um passo
 * separado, feito por quem envia, e deixa rasto. Não existe caminho no
 * código que escreva um rascunho já aprovado — as constraints da tabela
 * também não o permitiriam sem um utilizador identificado.
 */
export async function insertDraft(
  input: InsertDraftInput,
  db: Queryable = getPool(),
): Promise<AiDraftRow> {
  const result = await db.query<AiDraftRow>(
    `INSERT INTO ai_drafts
       (message_id, conversation_id, automation_level, content, status)
     VALUES ($1, $2, $3::automation_level, $4, 'DRAFT')
     RETURNING *`,
    [input.messageId, input.conversationId, input.automationLevel, input.content],
  );

  return result.rows[0]!;
}

export interface InsertNotificationInput {
  type: NotificationType;
  priority: Priority;
  title: string;
  body: string | null;
  conversationId: string | null;
  messageId: string | null;
  contactId: string | null;
}

export async function insertNotification(
  input: InsertNotificationInput,
  db: Queryable = getPool(),
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO notifications
       (type, priority, title, body, conversation_id, message_id, contact_id)
     VALUES ($1::notification_type, $2::message_priority, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.type,
      input.priority,
      input.title,
      input.body,
      input.conversationId,
      input.messageId,
      input.contactId,
    ],
  );

  return result.rows[0]!.id;
}
