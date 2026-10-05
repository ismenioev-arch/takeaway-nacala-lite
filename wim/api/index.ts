/**
 * Ponto de entrada da API quando o WIM corre na Vercel.
 *
 * Em servidor normal (Docker, VPS) quem arranca é `backend/src/server.ts`:
 * valida a configuração, liga à base de dados e abre uma porta.
 *
 * Na Vercel não há porta para abrir. Cada pedido HTTP acorda uma função e o
 * ficheiro que ela executa é este. A aplicação Fastify é exactamente a mesma
 * — só muda a forma de a alimentar: em vez de `app.listen()`, entregamos o
 * pedido ao servidor interno do Fastify com `emit('request')`.
 *
 * Todas as rotas passam por aqui: o `vercel.json` reescreve `/api/*` para
 * esta função, e o Fastify faz o encaminhamento interno como sempre fez.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../backend/src/app.js';
import { EnvValidationError } from '../backend/src/config/env.js';

/**
 * A instância é reaproveitada entre pedidos.
 *
 * A Vercel mantém o processo vivo entre invocações próximas no tempo (as
 * chamadas "quentes"). Construir o Fastify uma vez por processo, e não uma
 * vez por pedido, poupa dezenas de milissegundos e — mais importante —
 * mantém o pool de ligações ao PostgreSQL, em vez de abrir uma ligação nova
 * a cada pedido.
 */
let instance: Promise<FastifyInstance> | undefined;

function createInstance(): Promise<FastifyInstance> {
  return buildApp()
    .then(async (app) => {
      await app.ready();
      return app;
    })
    .catch((error: unknown) => {
      // Sem isto, uma falha de arranque ficaria em cache para sempre e todos
      // os pedidos seguintes herdariam a promessa rejeitada. Esquecemo-la
      // para que a invocação seguinte possa tentar de novo — por exemplo
      // depois de alguém corrigir uma variável de ambiente.
      instance = undefined;
      throw error;
    });
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let app: FastifyInstance;

  try {
    instance ??= createInstance();
    app = await instance;
  } catch (error) {
    // Falhar aqui é quase sempre configuração em falta. A mensagem do
    // EnvValidationError já é legível e diz exactamente o que falta, por isso
    // vale a pena registá-la nos logs da Vercel em vez de uma stack trace.
    const detail =
      error instanceof EnvValidationError
        ? error.issues.join('; ')
        : error instanceof Error
          ? error.message
          : String(error);

    console.error('[wim] a API não conseguiu arrancar:', detail);

    response.statusCode = 500;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(
      JSON.stringify({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'A API não está configurada correctamente. Consulte os logs do servidor.',
        },
      }),
    );
    return;
  }

  app.server.emit('request', request, response);
}
