/**
 * `/api/conversations` — a central de conversas (especificação, secções 9 a 12).
 *
 * Nota sobre a ordem das rotas: `/attention` e `/counts` são declaradas antes
 * de `/:id`. O Fastify dá precedência a rotas estáticas sobre parâmetros, mas
 * mantê-las juntas e por esta ordem evita dúvidas a quem leia o ficheiro.
 */
import type { FastifyInstance } from 'fastify';
import { actorFromRequest } from '../auth/actor.js';
import { idParamSchema } from '../validators/common.validators.js';
import {
  attentionQuerySchema,
  listConversationsQuerySchema,
  updateConversationSchema,
} from '../validators/conversation.validators.js';
import * as conversationsService from '../services/conversations.service.js';

export function registerConversationRoutes(app: FastifyInstance): void {
  app.get('/api/conversations', async (request) => {
    const query = listConversationsQuerySchema.parse(request.query);
    return conversationsService.listConversations(query);
  });

  /** A área mais importante do painel (secção 10). */
  app.get('/api/conversations/attention', async (request) => {
    const { limit } = attentionQuerySchema.parse(request.query);
    const items = await conversationsService.listAttention(limit);

    return { data: items };
  });

  /** Os cartões do painel principal (secção 9). */
  app.get('/api/conversations/counts', async () => {
    return conversationsService.getCounts();
  });

  app.get('/api/conversations/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return conversationsService.getConversation(id);
  });

  app.patch('/api/conversations/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const input = updateConversationSchema.parse(request.body);

    return conversationsService.updateConversation(id, input, actorFromRequest(request));
  });

  app.post('/api/conversations/:id/resolve', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return conversationsService.resolveConversation(id, actorFromRequest(request));
  });

  app.post('/api/conversations/:id/reopen', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return conversationsService.reopenConversation(id, actorFromRequest(request));
  });
}
