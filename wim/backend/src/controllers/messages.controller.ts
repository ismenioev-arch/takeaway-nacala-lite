/**
 * `/api/messages` e `/api/search` (especificação, secções 11 e 30).
 */
import type { FastifyInstance } from 'fastify';
import { idParamSchema } from '../validators/common.validators.js';
import {
  listMessagesQuerySchema,
  searchQuerySchema,
} from '../validators/message.validators.js';
import * as messagesService from '../services/messages.service.js';
import { searchEverything } from '../services/search.service.js';

export function registerMessageRoutes(app: FastifyInstance): void {
  app.get('/api/messages', async (request) => {
    const query = listMessagesQuerySchema.parse(request.query);
    return messagesService.listMessages(query);
  });

  app.get('/api/messages/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return messagesService.getMessage(id);
  });

  /** Chamado ao abrir uma conversa no painel. */
  app.post('/api/conversations/:id/read', async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    await messagesService.markConversationRead(id);

    return reply.status(204).send();
  });
}

export function registerSearchRoutes(app: FastifyInstance): void {
  app.get('/api/search', async (request) => {
    const { q, limit } = searchQuerySchema.parse(request.query);
    return searchEverything(q, limit);
  });
}
