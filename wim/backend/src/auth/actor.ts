/**
 * Quem está a executar a acção.
 *
 * Na FASE 3 ainda não há autenticação, por isso só conseguimos registar a
 * origem do pedido (endereço e cliente). O `userId` fica a `null`, que na
 * tabela `audit_logs` significa «acção do sistema».
 *
 * A FASE 4 acrescenta a autenticação e passa a preencher `userId` a partir da
 * sessão. Nada mais precisa de mudar: os serviços já recebem um `Actor`.
 */
import type { FastifyRequest } from 'fastify';
import type { Actor } from '../services/audit.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Preenchido na FASE 4, quando existir autenticação. */
    authenticatedUserId?: string;
  }
}

export function actorFromRequest(request: FastifyRequest): Actor {
  return {
    userId: request.authenticatedUserId ?? null,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}
