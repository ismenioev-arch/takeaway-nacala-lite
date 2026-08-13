/**
 * Tratamento centralizado de erros (especificação, secção 25).
 *
 * Duas garantias:
 *   1. O cliente recebe sempre a mesma forma de resposta de erro.
 *   2. Detalhes internos (SQL, caminhos, stack traces) nunca saem em produção.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { isProduction } from '../config/env.js';

/** Erro de negócio com código HTTP. Tudo o resto é tratado como 500. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Não autenticado.'): AppError {
    return new AppError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'Sem permissão para esta operação.'): AppError {
    return new AppError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Recurso não encontrado.'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError(409, 'CONFLICT', message, details);
  }
}

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

/** Traduz um `ZodError` para a lista de campos inválidos, legível por humanos. */
function formatZodIssues(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(raiz)',
    message: issue.message,
  }));
}

/**
 * Deve ser chamada DEPOIS de registar o `@fastify/rate-limit`: o tratador de
 * 404 reutiliza o mesmo limite. Sondar rotas ao acaso é exactamente o que faz
 * quem procura vulnerabilidades, e sem isto essa sondagem ficaria sem limite.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  const notFound = (request: FastifyRequest, reply: FastifyReply): void => {
    const body: ErrorResponseBody = {
      error: {
        code: 'NOT_FOUND',
        message: `Rota não encontrada: ${request.method} ${request.url}`,
        requestId: request.id,
      },
    };
    reply.status(404).send(body);
  };

  if (typeof app.rateLimit === 'function') {
    app.setNotFoundHandler({ preHandler: app.rateLimit() }, notFound);
  } else {
    app.setNotFoundHandler(notFound);
  }

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    // 1. Entrada inválida
    if (error instanceof ZodError) {
      request.log.info({ err: error }, 'entrada inválida');
      reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Os dados enviados são inválidos.',
          details: formatZodIssues(error),
          requestId: request.id,
        },
      } satisfies ErrorResponseBody);
      return;
    }

    // 2. Erro de negócio previsto
    if (error instanceof AppError) {
      request.log.info({ code: error.code, msg: error.message }, 'erro de aplicação');
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          requestId: request.id,
        },
      } satisfies ErrorResponseBody);
      return;
    }

    // 3. Erros que o próprio Fastify classifica (rate limit, JSON malformado…)
    const statusCode = error.statusCode ?? 500;

    if (statusCode < 500) {
      request.log.info({ err: error }, 'pedido rejeitado');
      reply.status(statusCode).send({
        error: {
          code: error.code ?? 'BAD_REQUEST',
          message: error.message,
          requestId: request.id,
        },
      } satisfies ErrorResponseBody);
      return;
    }

    // 4. Tudo o resto é um erro nosso. Registar por inteiro, revelar o mínimo.
    request.log.error({ err: error }, 'erro interno não tratado');

    reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: isProduction()
          ? 'Ocorreu um erro interno. A equipa foi notificada.'
          : error.message,
        requestId: request.id,
      },
    } satisfies ErrorResponseBody);
  });
}
