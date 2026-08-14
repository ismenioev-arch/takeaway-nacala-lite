/**
 * Os tipos enumerados do domínio.
 *
 * Espelham exactamente os `CREATE TYPE` da migração 001. São a fonte da
 * verdade do lado do TypeScript: os repositórios, os validadores e o schema
 * que a IA tem de devolver derivam todos daqui, para que acrescentar um valor
 * novo seja uma alteração num sítio só.
 */

/** Secção 4 — a ordem é a da gravidade, do mais urgente ao menos. */
export const PRIORITIES = ['URGENTE', 'IMPORTANTE', 'ACOMPANHAR', 'NORMAL'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Secção 5 — intenção principal da mensagem. */
export const INTENTS = [
  'NOVO_CLIENTE',
  'ORCAMENTO',
  'PROJETO',
  'ALTERACAO_PROJETO',
  'OBRA',
  'PAGAMENTO',
  'COBRANCA',
  'RECLAMACAO',
  'REUNIAO',
  'DOCUMENTO',
  'PRAZO',
  'SUPORTE',
  'INFORMACAO',
  'NEGOCIACAO',
  'OUTRO',
] as const;
export type Intent = (typeof INTENTS)[number];

/** Secção 22 — estados da conversa. */
export const CONVERSATION_STATUSES = [
  'NEW',
  'OPEN',
  'WAITING_HUMAN',
  'WAITING_CUSTOMER',
  'FOLLOW_UP',
  'RESOLVED',
  'ARCHIVED',
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** Conversas que ainda contam para o painel. */
export const CLOSED_CONVERSATION_STATUSES = ['RESOLVED', 'ARCHIVED'] as const satisfies
  readonly ConversationStatus[];

/** Secção 23 — estados da mensagem. */
export const MESSAGE_STATUSES = [
  'RECEIVED',
  'ANALYZING',
  'ANALYZED',
  'DRAFTED',
  'APPROVED',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_TYPES = [
  'text',
  'image',
  'document',
  'audio',
  'video',
  'sticker',
  'location',
  'contacts',
  'interactive',
  'button',
  'system',
  'unsupported',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Tipos que obrigam a identificar a media associada. */
export const MEDIA_MESSAGE_TYPES = [
  'image',
  'document',
  'audio',
  'video',
  'sticker',
] as const satisfies readonly MessageType[];

/** Secção 8 — níveis de automação. */
export const AUTOMATION_LEVELS = ['AUTO', 'DRAFT', 'HUMAN_REQUIRED'] as const;
export type AutomationLevel = (typeof AUTOMATION_LEVELS)[number];

export const DRAFT_STATUSES = [
  'DRAFT',
  'EDITED',
  'APPROVED',
  'SENT',
  'CANCELLED',
  'FAILED',
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** Secção 13 — categorias de contacto. */
export const CONTACT_CATEGORIES = [
  'CLIENTE',
  'PROSPECT',
  'FORNECEDOR',
  'PARCEIRO',
  'EQUIPA',
  'OUTRO',
] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

export const USER_ROLES = ['OWNER', 'ADMIN', 'AGENT'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Secção 21 — notificações. */
export const NOTIFICATION_TYPES = [
  'URGENT_MESSAGE',
  'APPROVAL_PENDING',
  'FOLLOW_UP_DUE',
  'SEND_FAILED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const FOLLOW_UP_STATUSES = ['PENDING', 'DONE', 'CANCELLED'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const WEBHOOK_EVENT_STATUSES = ['PENDING', 'PROCESSED', 'DUPLICATE', 'FAILED'] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

/**
 * Ordem de gravidade das prioridades, para comparar em código.
 * Menor número = mais grave. Coincide com a ordem do enum no PostgreSQL,
 * onde `ORDER BY priority` já coloca URGENTE primeiro.
 */
const PRIORITY_RANK: Record<Priority, number> = {
  URGENTE: 0,
  IMPORTANTE: 1,
  ACOMPANHAR: 2,
  NORMAL: 3,
};

/**
 * Devolve a mais grave de duas prioridades.
 *
 * Usada ao actualizar uma conversa: uma conversa urgente não deve "descer"
 * para normal só porque a mensagem seguinte foi um "obrigado".
 */
export function highestPriority(a: Priority, b: Priority): Priority {
  return PRIORITY_RANK[a] <= PRIORITY_RANK[b] ? a : b;
}

/** Ordena prioridades da mais grave para a menos grave. */
export function comparePriority(a: Priority, b: Priority): number {
  return PRIORITY_RANK[a] - PRIORITY_RANK[b];
}
