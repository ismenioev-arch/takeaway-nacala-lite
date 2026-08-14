/**
 * Regras de negócio das mensagens (especificação, secção 11).
 */
import { AppError } from '../middleware/errors.js';
import { paginate, type Paginated } from '../dtos/common.dto.js';
import { toMessageDto, type MessageDto } from '../dtos/message.dto.js';
import * as messagesRepo from '../repositories/messages.repository.js';
import * as conversationsRepo from '../repositories/conversations.repository.js';
import type { ListMessagesQuery } from '../validators/message.validators.js';

export async function listMessages(query: ListMessagesQuery): Promise<Paginated<MessageDto>> {
  // Confirmar que a conversa existe dá 404 em vez de uma lista vazia, que
  // seria indistinguível de "existe mas não tem mensagens".
  if (query.conversationId) {
    const conversation = await conversationsRepo.findConversationRow(query.conversationId);

    if (!conversation) {
      throw AppError.notFound('Conversa não encontrada.');
    }
  }

  const { rows, total } = await messagesRepo.listMessages({
    conversationId: query.conversationId,
    contactId: query.contactId,
    direction: query.direction,
    status: query.status,
    q: query.q,
    page: query.page,
    pageSize: query.pageSize,
    sortDirection: query.sortDirection,
  });

  return paginate(rows.map(toMessageDto), query.page, query.pageSize, total);
}

export async function getMessage(id: string): Promise<MessageDto> {
  const row = await messagesRepo.findMessageById(id);

  if (!row) {
    throw AppError.notFound('Mensagem não encontrada.');
  }

  return toMessageDto(row);
}

/** Marca a conversa como lida ao abri-la no painel. */
export async function markConversationRead(conversationId: string): Promise<void> {
  const conversation = await conversationsRepo.findConversationRow(conversationId);

  if (!conversation) {
    throw AppError.notFound('Conversa não encontrada.');
  }

  await messagesRepo.markConversationRead(conversationId);
}
