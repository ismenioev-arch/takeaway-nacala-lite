import { z } from 'zod';
import { MESSAGE_DIRECTIONS, MESSAGE_STATUSES } from '../models/enums.js';
import {
  multiValue,
  paginationSchema,
  searchTermSchema,
  sortDirectionSchema,
  uuidSchema,
} from './common.validators.js';

export const listMessagesQuerySchema = paginationSchema
  .extend({
    conversationId: uuidSchema.optional(),
    contactId: uuidSchema.optional(),
    direction: z.enum(MESSAGE_DIRECTIONS).optional(),
    status: multiValue(z.enum(MESSAGE_STATUSES)),
    q: searchTermSchema.optional(),
    // Ascendente por omissão: um histórico lê-se do mais antigo para o mais
    // recente, como num chat.
    sortDirection: sortDirectionSchema.default('asc'),
  })
  // Sem um destes filtros, o pedido devolveria mensagens de clientes
  // misturados — nunca é o que se pretende, e seria pesado.
  .refine((value) => value.conversationId || value.contactId || value.q, {
    message: 'indique conversationId, contactId ou um termo de pesquisa (q)',
  });
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

export const searchQuerySchema = z.object({
  q: searchTermSchema,
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;
