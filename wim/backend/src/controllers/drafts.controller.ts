/**
 * `/api/drafts` — os três botões do painel: [ENVIAR] [EDITAR] [CANCELAR].
 *
 * Todas as rotas exigem sessão. Não há aqui o caminho alternativo com
 * segredo que `/api/ai/analyze` tem, e isso é propositado: a fila de
 * análise é trabalho de máquina, isto é uma decisão de pessoa.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorFromRequest } from '../auth/actor.js';
import { requireAuth } from '../middleware/authenticate.js';
import { AppError } from '../middleware/errors.js';
import { idParamSchema } from '../validators/common.validators.js';
import { toPendingDraftDto } from '../dtos/draft.dto.js';
import * as draftsService from '../services/drafts.service.js';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const editSchema = z.object({
  content: z.string().trim().min(1, 'a resposta não pode ficar vazia').max(4000),
});

const sendSchema = z.object({
  /** Permite editar e enviar num só gesto, que é como as pessoas usam. */
  content: z.string().trim().min(1).max(4000).optional(),
});

export function registerDraftRoutes(app: FastifyInstance): void {
  const auth = { preHandler: requireAuth };

  /** GET /api/drafts — a fila de aprovações, as mais graves primeiro. */
  app.get('/api/drafts', auth, async (request) => {
    const { limit } = listQuerySchema.parse(request.query);
    const rows = await draftsService.listPending(limit);

    return {
      data: rows.map(toPendingDraftDto),
      // O painel precisa de saber se o botão de enviar vai funcionar antes
      // de o utilizador carregar nele.
      canSend: draftsService.canSend(),
    };
  });

  app.get('/api/drafts/:id', auth, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    return toPendingDraftDto(await draftsService.getDraft(id));
  });

  /** PATCH /api/drafts/:id — guardar a edição sem enviar. */
  app.patch('/api/drafts/:id', auth, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { content } = editSchema.parse(request.body);

    await draftsService.editDraft(id, content, actorFromRequest(request));

    return toPendingDraftDto(await draftsService.getDraft(id));
  });

  app.post('/api/drafts/:id/cancel', auth, async (request) => {
    const { id } = idParamSchema.parse(request.params);

    await draftsService.cancelDraft(id, actorFromRequest(request));

    return toPendingDraftDto(await draftsService.getDraft(id));
  });

  /**
   * POST /api/drafts/:id/send — a única porta para o cliente.
   *
   * O `request.user` vem do `requireAuth` e é obrigatório: sem pessoa
   * identificada não há aprovação, e a base de dados recusaria a escrita
   * mesmo que este código deixasse passar.
   */
  app.post('/api/drafts/:id/send', auth, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = sendSchema.parse(request.body ?? {});

    const user = request.user;
    if (!user) throw AppError.unauthorized('É necessário iniciar sessão para enviar.');

    const outcome = await draftsService.sendDraft(
      id,
      user.id,
      actorFromRequest(request),
      body.content === undefined ? {} : { content: body.content },
    );

    return {
      status: outcome.draft.status,
      messageId: outcome.messageId,
      waMessageId: outcome.waMessageId,
      sentBy: { id: user.id, name: user.name },
    };
  });
}
