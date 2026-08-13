import type {
  AutomationLevel,
  DraftStatus,
  Intent,
  MessageDirection,
  MessageStatus,
  MessageType,
  Priority,
} from '../models/enums.js';
import { toIso, toIsoRequired } from './common.dto.js';

/**
 * Linha do histórico: a mensagem, mais a análise da IA e o rascunho activo,
 * se existirem. Vêm juntos porque a interface da conversa mostra os três lado
 * a lado (secção 11).
 */
export interface MessageWithContextRow {
  id: string;
  conversation_id: string;
  contact_id: string;
  direction: MessageDirection;
  wa_message_id: string | null;
  type: MessageType;
  body: string | null;
  caption: string | null;
  media_id: string | null;
  media_mime: string | null;
  status: MessageStatus;
  wa_timestamp: Date;
  error_code: string | null;
  error_detail: string | null;
  created_at: Date;

  analysis_priority: Priority | null;
  analysis_intent: Intent | null;
  analysis_confidence: string | null;
  analysis_summary: string | null;
  analysis_urgency_reason: string | null;
  analysis_requires_human: boolean | null;
  analysis_recommended_action: string | null;

  draft_id: string | null;
  draft_content: string | null;
  draft_edited_content: string | null;
  draft_status: DraftStatus | null;
  draft_automation_level: AutomationLevel | null;
}

export interface MessageAnalysisDto {
  priority: Priority;
  intent: Intent;
  confidence: number;
  summary: string;
  urgencyReason: string | null;
  requiresHuman: boolean;
  recommendedAction: string | null;
}

export interface MessageDraftDto {
  id: string;
  automationLevel: AutomationLevel;
  status: DraftStatus;
  /** O que a IA propôs. Nunca é alterado. */
  content: string;
  /** O que a pessoa escreveu, se editou. */
  editedContent: string | null;
  /** O texto que seria enviado: a edição, se existir; senão o da IA. */
  effectiveContent: string;
  /** `true` quando esta resposta não pode sair sem aprovação humana. */
  requiresApproval: boolean;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  body: string | null;
  caption: string | null;
  mediaId: string | null;
  mediaMime: string | null;
  status: MessageStatus;
  timestamp: string;
  errorCode: string | null;
  errorDetail: string | null;
  analysis: MessageAnalysisDto | null;
  draft: MessageDraftDto | null;
}

export function toMessageDto(row: MessageWithContextRow): MessageDto {
  const analysis: MessageAnalysisDto | null =
    row.analysis_priority && row.analysis_intent && row.analysis_summary
      ? {
          priority: row.analysis_priority,
          intent: row.analysis_intent,
          // `numeric` chega como string do driver, para não perder precisão.
          confidence: Number(row.analysis_confidence ?? 0),
          summary: row.analysis_summary,
          urgencyReason: row.analysis_urgency_reason,
          requiresHuman: row.analysis_requires_human ?? false,
          recommendedAction: row.analysis_recommended_action,
        }
      : null;

  const draft: MessageDraftDto | null =
    row.draft_id && row.draft_content && row.draft_status && row.draft_automation_level
      ? {
          id: row.draft_id,
          automationLevel: row.draft_automation_level,
          status: row.draft_status,
          content: row.draft_content,
          editedContent: row.draft_edited_content,
          effectiveContent: row.draft_edited_content ?? row.draft_content,
          // Espelha a constraint `ai_drafts_send_requires_human_unless_auto`:
          // tudo o que não é AUTO precisa de uma pessoa (secções 3 e 8).
          requiresApproval: row.draft_automation_level !== 'AUTO',
        }
      : null;

  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    type: row.type,
    body: row.body,
    caption: row.caption,
    mediaId: row.media_id,
    mediaMime: row.media_mime,
    status: row.status,
    timestamp: toIsoRequired(row.wa_timestamp),
    errorCode: row.error_code,
    errorDetail: row.error_detail,
    analysis,
    draft,
  };
}

/** Resultado da pesquisa global (secção 30). */
export interface SearchResultDto {
  contacts: Array<{ id: string; name: string; phone: string; company: string | null }>;
  conversations: Array<{
    id: string;
    contactName: string;
    subject: string | null;
    priority: Priority;
    lastMessageAt: string | null;
  }>;
  messages: Array<{
    id: string;
    conversationId: string;
    contactName: string;
    excerpt: string;
    timestamp: string;
  }>;
}

export const toIsoOrNull = toIso;
