import { z } from 'zod';
import { CONVERSATION_STATUSES, INTENTS, PRIORITIES } from '../models/enums.js';
import {
  dateRangeSchema,
  multiValue,
  optionalText,
  paginationSchema,
  queryBooleanSchema,
  searchTermSchema,
  sortDirectionOptionalSchema,
  uuidSchema,
} from './common.validators.js';

export const CONVERSATION_SORT_FIELDS = ['lastMessageAt', 'priority', 'createdAt'] as const;

/**
 * Filtros da secção 12.
 *
 * Os atalhos (`unanswered`, `awaitingApproval`, `resolved`) existem porque são
 * exactamente os separadores do painel — deixar o frontend montá-los à mão a
 * partir de filtros soltos seria repetir a mesma regra em dois sítios.
 */
export const listConversationsQuerySchema = paginationSchema
  .extend({
    q: searchTermSchema.optional(),
    status: multiValue(z.enum(CONVERSATION_STATUSES)),
    priority: multiValue(z.enum(PRIORITIES)),
    intent: multiValue(z.enum(INTENTS)),
    contactId: uuidSchema.optional(),
    tagId: uuidSchema.optional(),

    /** Última mensagem foi do cliente e ainda não respondemos. */
    unanswered: queryBooleanSchema.optional(),
    /** Tem rascunhos por decidir. */
    awaitingApproval: queryBooleanSchema.optional(),
    /** `true` mostra só resolvidas; `false` exclui resolvidas e arquivadas. */
    resolved: queryBooleanSchema.optional(),

    sortBy: z.enum(CONVERSATION_SORT_FIELDS).default('lastMessageAt'),
    // Sem valor por omissão de propósito: o sentido de "descendente" depende
    // do campo. Ordenar por prioridade "descendente" poria as normais no topo,
    // que é o contrário do que qualquer pessoa espera. O serviço escolhe o
    // valor certo quando não vem indicado (ver `resolveSortDirection`).
    sortDirection: sortDirectionOptionalSchema.optional(),
  })
  .and(dateRangeSchema);
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

export const attentionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AttentionQuery = z.infer<typeof attentionQuerySchema>;

export const updateConversationSchema = z
  .object({
    status: z.enum(CONVERSATION_STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    subject: optionalText(300),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'indique pelo menos um campo para actualizar',
  })
  // Resolver e reabrir têm endpoints próprios, que tratam da data de
  // resolução. Permitir fazê-lo por PATCH deixaria a data por preencher e a
  // constraint da base de dados recusaria, com um erro pouco claro.
  .refine((value) => value.status !== 'RESOLVED', {
    message: 'para resolver uma conversa use POST /api/conversations/:id/resolve',
    path: ['status'],
  });
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
