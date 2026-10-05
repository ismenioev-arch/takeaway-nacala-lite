/**
 * O rascunho como o painel precisa de o ver.
 *
 * Um cartão de aprovação tem de responder a três perguntas em poucos
 * segundos: *o que é que o cliente disse*, *o que é que a IA percebeu* e
 * *o que é que ela propõe responder*. Por isso o DTO junta os três — a
 * alternativa seria o painel fazer três pedidos e montar o puzzle
 * sozinho.
 */
import type { AutomationLevel, DraftStatus, Intent, Priority } from '../models/enums.js';
import type { DraftWithContextRow } from '../repositories/drafts.repository.js';

export interface PendingDraftDto {
  id: string;
  conversationId: string;
  messageId: string;
  status: DraftStatus;
  automationLevel: AutomationLevel;
  /** `true` quando esta resposta não pode sair sem uma pessoa aprovar. */
  requiresApproval: boolean;

  /** O que a IA propôs. Nunca muda. */
  content: string;
  /** O que a pessoa escreveu, se editou. */
  editedContent: string | null;
  /** O que seria enviado agora. */
  effectiveContent: string;

  contact: {
    id: string;
    name: string | null;
    phone: string;
  };

  inbound: {
    body: string | null;
    type: string;
    timestamp: string;
  };

  analysis: {
    priority: Priority | null;
    intent: Intent | null;
    confidence: number | null;
    summary: string | null;
    urgencyReason: string | null;
    recommendedAction: string | null;
  };

  conversationPriority: Priority;
  createdAt: string;
}

export function toPendingDraftDto(row: DraftWithContextRow): PendingDraftDto {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    status: row.status,
    automationLevel: row.automation_level,
    // Espelha a constraint `ai_drafts_send_requires_human_unless_auto`.
    requiresApproval: row.automation_level !== 'AUTO',

    content: row.content,
    editedContent: row.edited_content,
    effectiveContent: row.edited_content ?? row.content,

    contact: {
      id: row.contact_id,
      name: row.contact_name,
      phone: row.contact_phone,
    },

    inbound: {
      body: row.inbound_body,
      type: row.inbound_type,
      timestamp: row.inbound_timestamp.toISOString(),
    },

    analysis: {
      priority: (row.analysis_priority as Priority | null) ?? null,
      intent: (row.analysis_intent as Intent | null) ?? null,
      // `numeric` chega como string, para não perder precisão pelo caminho.
      confidence: row.analysis_confidence === null ? null : Number(row.analysis_confidence),
      summary: row.analysis_summary,
      urgencyReason: row.analysis_urgency_reason,
      recommendedAction: row.analysis_recommended_action,
    },

    conversationPriority: row.conversation_priority as Priority,
    createdAt: row.created_at.toISOString(),
  };
}
