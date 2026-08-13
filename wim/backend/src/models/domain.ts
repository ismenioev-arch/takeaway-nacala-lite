/**
 * As linhas das tabelas, do lado do TypeScript.
 *
 * Cada tipo espelha uma tabela da migração 002, com os mesmos nomes de coluna
 * (em snake_case) para que uma consulta possa ser tipada sem tradução pelo
 * meio. A conversão para os nomes da API acontece nos DTOs, na FASE 3.
 */
import type {
  AutomationLevel,
  ContactCategory,
  ConversationStatus,
  DraftStatus,
  FollowUpStatus,
  Intent,
  MessageDirection,
  MessageStatus,
  MessageType,
  NotificationType,
  Priority,
  UserRole,
  WebhookEventStatus,
} from './enums.js';

/** Campos comuns a quase todas as tabelas. */
export interface Timestamped {
  created_at: Date;
  updated_at: Date;
}

export interface UserRow extends Timestamped {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  last_login_at: Date | null;
}

export interface ContactRow extends Timestamped {
  id: string;
  wa_id: string;
  phone_e164: string;
  profile_name: string | null;
  display_name: string | null;
  company: string | null;
  location: string | null;
  notes: string | null;
  category: ContactCategory;
  first_contact_at: Date;
  last_contact_at: Date;
  conversation_count: number;
  /** Coluna calculada pelo PostgreSQL. Nunca escrever. */
  search_text: string;
}

export interface ConversationRow extends Timestamped {
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
  resolved_by: string | null;
}

export interface MessageRow extends Timestamped {
  id: string;
  conversation_id: string;
  contact_id: string;
  direction: MessageDirection;
  /** Chave da idempotência. NULL só em mensagens de saída ainda não entregues. */
  wa_message_id: string | null;
  type: MessageType;
  body: string | null;
  caption: string | null;
  media_id: string | null;
  media_mime: string | null;
  media_sha256: string | null;
  status: MessageStatus;
  sent_by_user_id: string | null;
  wa_timestamp: Date;
  error_code: string | null;
  error_detail: string | null;
  raw: unknown;
}

export interface MessageAnalysisRow {
  id: string;
  message_id: string;
  priority: Priority;
  intent: Intent;
  /** Entre 0 e 1. O driver `pg` devolve `numeric` como string. */
  confidence: string;
  summary: string;
  urgency_reason: string | null;
  requires_human: boolean;
  recommended_action: string | null;
  model: string;
  prompt_version: string;
  tokens_input: number | null;
  tokens_output: number | null;
  latency_ms: number | null;
  raw_response: unknown;
  created_at: Date;
}

export interface AiDraftRow extends Timestamped {
  id: string;
  message_id: string;
  conversation_id: string;
  automation_level: AutomationLevel;
  /** O que a IA propôs. Nunca é alterado. */
  content: string;
  /** O que o humano escreveu, se editou. */
  edited_content: string | null;
  status: DraftStatus;
  approved_by_user_id: string | null;
  approved_at: Date | null;
  sent_message_id: string | null;
  error_code: string | null;
  error_detail: string | null;
}

export interface TagRow extends Timestamped {
  id: string;
  name: string;
  color: string;
}

export interface NotificationRow {
  id: string;
  type: NotificationType;
  priority: Priority;
  title: string;
  body: string | null;
  conversation_id: string | null;
  message_id: string | null;
  contact_id: string | null;
  is_read: boolean;
  read_at: Date | null;
  read_by: string | null;
  created_at: Date;
}

export interface FollowUpRow extends Timestamped {
  id: string;
  conversation_id: string;
  contact_id: string;
  due_at: Date;
  note: string | null;
  status: FollowUpStatus;
  created_by: string | null;
  completed_at: Date | null;
}

export interface AuditLogRow {
  id: string;
  /** NULL = acção do sistema, não de uma pessoa. */
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_value: unknown;
  new_value: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

export interface CompanyProfileRow extends Timestamped {
  id: number;
  name: string;
  description: string | null;
  location: string | null;
  business_hours: unknown;
  contact_phone: string | null;
  contact_email: string | null;
  policies: string | null;
  service_rules: string | null;
  auto_reply_enabled: boolean;
}

export interface CompanyServiceRow extends Timestamped {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  display_order: number;
}

export interface CompanyPriceRow extends Timestamped {
  id: string;
  service_id: string | null;
  label: string;
  /** `numeric` chega como string do driver `pg`, para não perder precisão. */
  amount: string;
  currency: string;
  notes: string | null;
  /** A IA só recebe os preços com `true`. */
  is_authorized_for_ai: boolean;
}

export interface CompanyFaqRow extends Timestamped {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  is_active: boolean;
  display_order: number;
}

export interface WebhookEventRow {
  id: string;
  provider: string;
  external_id: string;
  payload: unknown;
  signature_valid: boolean;
  status: WebhookEventStatus;
  error: string | null;
  received_at: Date;
  processed_at: Date | null;
}

export interface SettingRow extends Timestamped {
  key: string;
  value: unknown;
  description: string | null;
  updated_by: string | null;
}
