/**
 * Preserva o corpo BRUTO dos pedidos JSON.
 *
 * Porquê: a Meta assina o webhook com HMAC-SHA256 sobre os bytes exactos que
 * enviou (cabeçalho `X-Hub-Signature-256`). Se lermos o JSON, o
 * reserializarmos e assinarmos isso, o hash não bate — a reserialização muda
 * espaços, ordem de chaves e escapes.
 *
 * Por isso guardamos o Buffer original em `request.rawBody` ANTES de fazer
 * parse. A verificação da assinatura (FASE 6) usa esse Buffer.
 *
 * Nota: o corpo bruto só é guardado nas rotas que dele precisam, para não
 * duplicar a memória de todos os pedidos da API.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Bytes exactos do corpo, presentes apenas nas rotas em `RAW_BODY_ROUTES`. */
    rawBody?: Buffer;
  }
}

/** Rotas que precisam do corpo bruto para validação criptográfica. */
export const RAW_BODY_ROUTES = ['/api/webhooks/whatsapp'];

const needsRawBody = (request: FastifyRequest): boolean =>
  RAW_BODY_ROUTES.some((route) => request.url.split('?')[0] === route);

export function registerRawBodyParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, payload: Buffer, done) => {
      if (needsRawBody(request)) {
        request.rawBody = payload;
      }

      // Corpo vazio é válido: trata-se como ausência de corpo, não como erro.
      if (payload.length === 0) {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(payload.toString('utf8')) as unknown);
      } catch {
        const error = Object.assign(new Error('O corpo do pedido não é JSON válido.'), {
          statusCode: 400,
          code: 'INVALID_JSON',
        });
        done(error, undefined);
      }
    },
  );
}
