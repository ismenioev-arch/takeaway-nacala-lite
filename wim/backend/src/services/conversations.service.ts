/**
 * Regras de negócio das conversas (especificação, secções 9, 10, 12 e 22).
 */
import { AppError } from '../middleware/errors.js';
import { paginate, type Paginated } from '../dtos/common.dto.js';
import {
  toAttentionItemDto,
  toConversationDto,
  type AttentionItemDto,
  type ConversationDto,
} from '../dtos/conversation.dto.js';
import * as conversationsRepo from '../repositories/conversations.repository.js';
import type { ConversationSortField } from '../repositories/conversations.repository.js';
import type {
  ListConversationsQuery,
  UpdateConversationInput,
} from '../validators/conversation.validators.js';
import { AUDIT_ACTIONS, diffValues, recordAudit, type Actor } from './audit.service.js';

/**
 * Escolhe o sentido de ordenação quando quem chama não o indica.
 *
 * Por prioridade, "primeiro" significa "mais urgente" — e no PostgreSQL isso
 * é ordem ASCENDENTE, porque o enum foi declarado com URGENTE à cabeça.
 * Para datas, "primeiro" significa "mais recente", que é DESCENDENTE.
 */
export function resolveSortDirection(
  sortBy: ConversationSortField,
  requested: 'asc' | 'desc' | undefined,
): 'asc' | 'desc' {
  if (requested) return requested;
  return sortBy === 'priority' ? 'asc' : 'desc';
}

export async function listConversations(
  query: ListConversationsQuery,
): Promise<Paginated<ConversationDto>> {
  const { rows, total } = await conversationsRepo.listConversations({
    q: query.q,
    status: query.status,
    priority: query.priority,
    intent: query.intent,
    contactId: query.contactId,
    tagId: query.tagId,
    unanswered: query.unanswered,
    awaitingApproval: query.awaitingApproval,
    resolved: query.resolved,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    sortBy: query.sortBy,
    sortDirection: resolveSortDirection(query.sortBy, query.sortDirection),
    page: query.page,
    pageSize: query.pageSize,
  });

  const now = new Date();
  return paginate(
    rows.map((row) => toConversationDto(row, now)),
    query.page,
    query.pageSize,
    total,
  );
}

/** A área «Precisa da Minha Atenção» (secção 10). */
export async function listAttention(limit: number): Promise<AttentionItemDto[]> {
  const rows = await conversationsRepo.listAttention(limit);
  const now = new Date();

  return rows.map((row) => toAttentionItemDto(row, now));
}

/** Os cartões do painel principal (secção 9). */
export async function getCounts(): Promise<conversationsRepo.ConversationCounts> {
  return conversationsRepo.countConversations();
}

export async function getConversation(id: string): Promise<ConversationDto> {
  const row = await conversationsRepo.findConversationById(id);

  if (!row) {
    throw AppError.notFound('Conversa não encontrada.');
  }

  return toConversationDto(row);
}

export async function updateConversation(
  id: string,
  input: UpdateConversationInput,
  actor?: Actor,
): Promise<ConversationDto> {
  const before = await conversationsRepo.findConversationRow(id);

  if (!before) {
    throw AppError.notFound('Conversa não encontrada.');
  }

  const after = await conversationsRepo.updateConversation(id, input);

  if (!after) {
    throw AppError.notFound('Conversa não encontrada.');
  }

  const { oldValue, newValue, changed } = diffValues(before, after, [
    'status',
    'priority',
    'subject',
  ]);

  if (changed) {
    await recordAudit({
      action: AUDIT_ACTIONS.conversationUpdated,
      entityType: 'conversations',
      entityId: id,
      oldValue,
      newValue,
      actor,
    });
  }

  return getConversation(id);
}

export async function resolveConversation(
  id: string,
  actor?: Actor,
): Promise<ConversationDto> {
  const before = await conversationsRepo.findConversationRow(id);

  if (!before) {
    throw AppError.notFound('Conversa não encontrada.');
  }

  if (before.status === 'RESOLVED') {
    throw AppError.conflict('Esta conversa já está resolvida.');
  }

  await conversationsRepo.resolveConversation(id, actor?.userId ?? null);

  await recordAudit({
    action: AUDIT_ACTIONS.conversationResolved,
    entityType: 'conversations',
    entityId: id,
    oldValue: { status: before.status },
    newValue: { status: 'RESOLVED' },
    actor,
  });

  return getConversation(id);
}

export async function reopenConversation(id: string, actor?: Actor): Promise<ConversationDto> {
  const before = await conversationsRepo.findConversationRow(id);

  if (!before) {
    throw AppError.notFound('Conversa não encontrada.');
  }

  if (before.status !== 'RESOLVED' && before.status !== 'ARCHIVED') {
    throw AppError.conflict('Esta conversa não está resolvida nem arquivada.');
  }

  // A base de dados só permite uma conversa aberta por contacto. Reabrir uma
  // antiga quando já existe outra em curso daria um erro de índice único —
  // vale a pena explicar em vez de deixar passar o erro cru.
  const open = await conversationsRepo.listConversations({
    contactId: before.contact_id,
    resolved: false,
    sortBy: 'lastMessageAt',
    sortDirection: 'desc',
    page: 1,
    pageSize: 1,
  });

  if (open.total > 0) {
    throw AppError.conflict(
      'Este contacto já tem uma conversa aberta. Resolva-a antes de reabrir esta.',
      { openConversationId: open.rows[0]?.id },
    );
  }

  await conversationsRepo.reopenConversation(id);

  await recordAudit({
    action: AUDIT_ACTIONS.conversationReopened,
    entityType: 'conversations',
    entityId: id,
    oldValue: { status: before.status },
    newValue: { status: 'OPEN' },
    actor,
  });

  return getConversation(id);
}
