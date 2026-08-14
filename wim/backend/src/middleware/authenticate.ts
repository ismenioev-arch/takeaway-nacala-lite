/**
 * Protecção dos endpoints (especificação, secção 25).
 *
 * `requireAuth` recusa o pedido sem um access token válido.
 * `requireRole` acrescenta a verificação do papel.
 *
 * Ambos correm como `preHandler`, antes do corpo da rota — uma rota protegida
 * nunca chega a executar sem utilizador.
 */
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { AppError } from './errors.js';
import { extractBearerToken, verifyAccessToken, InvalidTokenError } from '../auth/tokens.js';
import { resolveTokenUser } from '../services/auth.service.js';
import type { UserRole } from '../models/enums.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Preenchido por `requireAuth`. */
    user?: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
    };
  }
}

export const requireAuth: preHandlerHookHandler = async (
  request: FastifyRequest,
  _reply: FastifyReply,
) => {
  const token = extractBearerToken(request.headers.authorization);

  if (!token) {
    throw AppError.unauthorized('É necessário iniciar sessão.');
  }

  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch (error) {
    if (error instanceof InvalidTokenError) {
      throw AppError.unauthorized('Sessão inválida ou expirada. Entre de novo.');
    }
    throw error;
  }

  // A assinatura só prova que o token foi emitido por nós. Falta confirmar
  // que a conta continua activa e que a password não mudou entretanto.
  const user = await resolveTokenUser(claims.sub, claims.iatMs);

  request.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };

  // Faz o utilizador chegar à auditoria sem cada controlador ter de o passar.
  request.authenticatedUserId = user.id;
};

/**
 * Hierarquia de papéis. Um número menor tem mais poderes: quem é `OWNER`
 * pode tudo o que um `ADMIN` pode, e assim por diante.
 */
const ROLE_RANK: Record<UserRole, number> = {
  OWNER: 0,
  ADMIN: 1,
  AGENT: 2,
};

/**
 * Exige um papel mínimo.
 *
 * Corre sempre a seguir a `requireAuth` — daí `authenticated()`, que devolve
 * os dois na ordem certa. Se `request.user` não estiver preenchido é porque a
 * rota foi mal montada; recusar é mais seguro do que deixar passar.
 */
export function requireRole(minimum: UserRole): preHandlerHookHandler {
  return async (request) => {
    const role = request.user?.role;

    if (!role || ROLE_RANK[role] > ROLE_RANK[minimum]) {
      throw AppError.forbidden('Não tem permissão para esta operação.');
    }
  };
}

/** Protege uma rota, opcionalmente exigindo um papel mínimo. */
export function authenticated(minimum?: UserRole): preHandlerHookHandler[] {
  return minimum ? [requireAuth, requireRole(minimum)] : [requireAuth];
}

/** Verifica se um papel satisfaz o mínimo exigido. Exportada para testes. */
export function roleSatisfies(role: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[role] <= ROLE_RANK[minimum];
}
