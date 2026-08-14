/**
 * Repositório para message_analysis.
 *
 * Cada mensagem inbound recebe uma análise da IA: intent, priority, confidence, etc.
 * Uma conversa é resolvida e re-aberta com base nesta análise.
 */
import type { MessageAnalysisRow } from '../models/domain.js';
import type { Intent, Priority } from '../models/enums.js';
import { getPool, type Queryable } from '../database/pool.js';

export interface InsertMessageAnalysisInput {
  messageId: string;
  priority: Priority;
  intent: Intent;
  confidence: number;
  summary: string;
  urgencyReason?: string | null;
  requiresHuman: boolean;
  recommendedAction?: string | null;
  model: string;
  promptVersion: string;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  latencyMs?: number | null;
  rawResponse?: unknown;
}

export async function insertMessageAnalysis(
  input: InsertMessageAnalysisInput,
  db: Queryable = getPool(),
): Promise<MessageAnalysisRow> {
  const result = await db.query<MessageAnalysisRow>(
    `INSERT INTO message_analysis
       (message_id, priority, intent, confidence, summary, urgency_reason,
        requires_human, recommended_action, model, prompt_version,
        tokens_input, tokens_output, latency_ms, raw_response)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      input.messageId,
      input.priority,
      input.intent,
      input.confidence,
      input.summary,
      input.urgencyReason ?? null,
      input.requiresHuman,
      input.recommendedAction ?? null,
      input.model,
      input.promptVersion,
      input.tokensInput ?? null,
      input.tokensOutput ?? null,
      input.latencyMs ?? null,
      input.rawResponse ? JSON.stringify(input.rawResponse) : null,
    ],
  );

  return result.rows[0]!;
}

export async function findByMessageId(
  messageId: string,
  db: Queryable = getPool(),
): Promise<MessageAnalysisRow | null> {
  const result = await db.query<MessageAnalysisRow>(
    `SELECT * FROM message_analysis WHERE message_id = $1`,
    [messageId],
  );

  return result.rows[0] ?? null;
}
