import type { ContactCategory, ConversationStatus, Intent, Priority } from '../models/enums.js';
import { toIso, toIsoRequired } from './common.dto.js';
import { toContactSummaryDto, type ContactSummaryDto } from './contact.dto.js';

/**
 * Linha devolvida pelas consultas de conversas: a conversa mais os campos do
 * contacto e da última análise de que o painel precisa para desenhar a lista
 * sem fazer um pedido por linha.
 */
export interface ConversationListRow {
  id: string;
  contact_id: string;
  status: ConversationStatus;
  priority: Priority;
  subject: string | null;
  last_message_at: Date | null;
  last_inbound_at: Date | null;
  last_outbound_at: Date | null;
  unread_count: number;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;

  // Do contacto
  display_name: string | null;
  profile_name: string | null;
  phone_e164: string;
  company: string | null;
  category: ContactCategory;

  // Da última análise da IA
  latest_summary: string | null;
  latest_intent: Intent | null;
  latest_urgency_reason: string | null;
  latest_recommended_action: string | null;

  // Agregados
  pending_drafts: number;
  last_message_preview: string | null;
}

export interface ConversationDto {
  id: string;
  status: ConversationStatus;
  priority: Priority;
  subject: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;

  contact: ContactSummaryDto;

  /** O que a IA concluiu sobre a última mensagem analisada. */
  analysis: {
    summary: string | null;
    intent: Intent | null;
    urgencyReason: string | null;
    recommendedAction: string | null;
  };

  lastMessagePreview: string | null;
  pendingDrafts: number;
  /** `true` quando a última mensagem foi do cliente e ainda não respondemos. */
  awaitingReply: boolean;
  /** Minutos desde a última mensagem recebida. Null se nunca recebeu nenhuma. */
  minutesSinceLastInbound: number | null;
}

/**
 * Uma conversa está por responder quando a última mensagem do cliente é mais
 * recente do que a nossa última resposta — ou quando nunca respondemos.
 */
export function isAwaitingReply(row: {
  last_inbound_at: Date | null;
  last_outbound_at: Date | null;
}): boolean {
  if (!row.last_inbound_at) return false;
  if (!row.last_outbound_at) return true;

  return row.last_inbound_at > row.last_outbound_at;
}

function minutesSince(value: Date | null, now: Date): number | null {
  if (!value) return null;
  return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 60_000));
}

export function toConversationDto(row: ConversationListRow, now = new Date()): ConversationDto {
  return {
    id: row.id,
    status: row.status,
    priority: row.priority,
    subject: row.subject,
    unreadCount: row.unread_count,
    lastMessageAt: toIso(row.last_message_at),
    lastInboundAt: toIso(row.last_inbound_at),
    lastOutboundAt: toIso(row.last_outbound_at),
    resolvedAt: toIso(row.resolved_at),
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),

    contact: toContactSummaryDto({
      id: row.contact_id,
      display_name: row.display_name,
      profile_name: row.profile_name,
      phone_e164: row.phone_e164,
      company: row.company,
      category: row.category,
    }),

    analysis: {
      summary: row.latest_summary,
      intent: row.latest_intent,
      urgencyReason: row.latest_urgency_reason,
      recommendedAction: row.latest_recommended_action,
    },

    lastMessagePreview: row.last_message_preview,
    pendingDrafts: Number(row.pending_drafts ?? 0),
    awaitingReply: isAwaitingReply(row),
    minutesSinceLastInbound: minutesSince(row.last_inbound_at, now),
  };
}

/**
 * O item da área «Precisa da Minha Atenção» (secção 10).
 *
 * É intencionalmente mais estreito do que `ConversationDto`: esta área tem de
 * ser lida num relance, por isso devolve só o que aparece no cartão.
 */
export interface AttentionItemDto {
  conversationId: string;
  priority: Priority;
  contact: ContactSummaryDto;
  subject: string | null;
  summary: string | null;
  urgencyReason: string | null;
  recommendedAction: string | null;
  minutesSinceLastInbound: number | null;
  pendingDrafts: number;
  awaitingReply: boolean;
}

export function toAttentionItemDto(
  row: ConversationListRow,
  now = new Date(),
): AttentionItemDto {
  return {
    conversationId: row.id,
    priority: row.priority,
    contact: toContactSummaryDto({
      id: row.contact_id,
      display_name: row.display_name,
      profile_name: row.profile_name,
      phone_e164: row.phone_e164,
      company: row.company,
      category: row.category,
    }),
    subject: row.subject,
    summary: row.latest_summary,
    urgencyReason: row.latest_urgency_reason,
    recommendedAction: row.latest_recommended_action,
    minutesSinceLastInbound: minutesSince(row.last_inbound_at, now),
    pendingDrafts: Number(row.pending_drafts ?? 0),
    awaitingReply: isAwaitingReply(row),
  };
}
