/**
 * `/api/ai` — disparar e observar a fila de análise.
 *
 * A fila precisa de quem a empurre, e em serverless não há processo entre
 * pedidos para o fazer sozinho. Por isso a execução é um endpoint, chamável
 * por três caminhos diferentes, todos legítimos:
 *
 *   · um agendador (Vercel Cron, GitHub Actions, cron-job.org), com o
 *     cabeçalho `Authorization: Bearer <CRON_SECRET>`;
 *   · o painel, com a sessão do utilizador, quando alguém quer ver já o
 *     resultado em vez de esperar pelo próximo ciclo;
 *   · o worker interno, quando o WIM corre num servidor permanente.
 *
 * Aceitar as duas autenticações no mesmo endereço evita ter dois caminhos
 * de código a fazer a mesma coisa — e é o caminho duplicado, não o
 * partilhado, que costuma ficar por testar.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getEnv, isAiEnabled } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
import { requireAuth } from '../middleware/authenticate.js';
import { getAnalysisQueueStats } from '../repositories/messages.repository.js';
import * as analysisService from '../services/analysis.service.js';
import { compareTimingSafe } from '../middleware/whatsapp-webhook.js';

const runSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/**
 * O pedido traz o segredo do agendador?
 *
 * Comparação em tempo constante, pela mesma razão do token do webhook: um
 * `!==` devolve mais depressa quanto mais cedo diferirem os caracteres, e
 * isso chega para adivinhar o segredo letra a letra.
 */
function hasCronSecret(request: FastifyRequest): boolean {
  const configured = getEnv().CRON_SECRET;
  if (!configured) return false;

  const header = request.headers.authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (provided === '') return false;

  return compareTimingSafe(provided, configured);
}

export function registerAiRoutes(app: FastifyInstance): void {
  /**
   * Com a IA desligada as rotas existem mas recusam-se a trabalhar, pelo
   * mesmo motivo do webhook: 503 diz «o endereço está certo, a
   * funcionalidade é que não está ligada», enquanto 404 mandaria alguém
   * procurar um erro de configuração inexistente.
   */
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/ai')) return;
    if (isAiEnabled()) return;

    throw AppError.serviceUnavailable(
      'A análise pela IA está desligada neste ambiente. ' +
        'Defina AI_ENABLED=true e ANTHROPIC_API_KEY para a activar.',
    );
  });

  /**
   * Processa um lote da fila.
   *
   * Responde com o que fez. Um agendador que receba `remaining > 0` sabe
   * que vale a pena voltar já em vez de esperar pelo ciclo seguinte.
   *
   * Registado em POST **e** em GET, e isso é deliberado apesar de a
   * operação não ser inofensiva: o Vercel Cron invoca sempre por GET, e
   * ter um endereço diferente só para ele seria um segundo caminho de
   * código a fazer exactamente o mesmo — e é o caminho duplicado que
   * costuma ficar por testar. O que protege o endereço não é o método, é
   * o segredo: sem ele, nem GET nem POST passam.
   */
  const run = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!hasCronSecret(request)) {
      // Sem segredo de agendador, tem de ser uma pessoa com sessão.
      // O cast existe porque `requireAuth` é tipado como hook do Fastify
      // (com um terceiro argumento `done` que a versão assíncrona ignora).
      // Chamá-lo à mão é deliberado: a autenticação aqui é condicional.
      await (requireAuth as (req: FastifyRequest, rep: FastifyReply) => Promise<void>)(
        request,
        reply,
      );
    }

    const { limit } = runSchema.parse(request.query ?? {});
    const result = await analysisService.runAnalysisBatch(limit);

    return {
      analyzed: result.analyzed,
      retried: result.retried,
      failed: result.failed,
      remaining: result.remaining,
    };
  };

  app.post('/api/ai/analyze', run);
  app.get('/api/ai/analyze', run);

  /** GET /api/ai/queue — quantas mensagens esperam, correm ou desistiram. */
  app.get('/api/ai/queue', { preHandler: requireAuth }, async () => {
    return getAnalysisQueueStats();
  });
}
