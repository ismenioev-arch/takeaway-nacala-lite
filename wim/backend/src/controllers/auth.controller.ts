/**
 * `/api/auth` — entrada, renovação e saída (especificação, secção 25).
 *
 * Todas as rotas deste ficheiro são públicas, excepto `/me`,
 * `/change-password`, `/logout-all` e a criação de utilizadores.
 */
import type { FastifyInstance } from 'fastify';
import { durationToMs } from '../app.js';
import { getEnv } from '../config/env.js';
import { actorFromRequest } from '../auth/actor.js';
import { authenticated, requireAuth } from '../middleware/authenticate.js';
import { AppError } from '../middleware/errors.js';
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  refreshSchema,
} from '../validators/auth.validators.js';
import * as authService from '../services/auth.service.js';
import * as usersRepo from '../repositories/users.repository.js';
import * as sessionsRepo from '../repositories/sessions.repository.js';

export function registerAuthRoutes(app: FastifyInstance): void {
  /**
   * Limite por endereço, mais apertado do que o global. É a primeira linha de
   * defesa; a segunda — e a que realmente protege cada conta — é o bloqueio
   * por e-mail guardado na base de dados, que um IP partilhado não contorna.
   */
  const env = getEnv();
  const loginRateLimit = {
    config: {
      rateLimit: {
        max: env.LOGIN_RATE_LIMIT_MAX,
        timeWindow: durationToMs(env.LOGIN_RATE_LIMIT_WINDOW),
      },
    },
  };

  app.post('/api/auth/login', loginRateLimit, async (request) => {
    const { email, password } = loginSchema.parse(request.body);

    return authService.login(email, password, actorFromRequest(request));
  });

  app.post('/api/auth/refresh', loginRateLimit, async (request) => {
    const { refreshToken } = refreshSchema.parse(request.body);

    return authService.refresh(refreshToken, actorFromRequest(request));
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const { refreshToken } = refreshSchema.parse(request.body);
    await authService.logout(refreshToken, actorFromRequest(request));

    return reply.status(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    const sessions = await sessionsRepo.countActiveSessions(request.user!.id);

    return { user: request.user, activeSessions: sessions };
  });

  app.post(
    '/api/auth/change-password',
    { preHandler: requireAuth },
    async (request, reply) => {
      const input = changePasswordSchema.parse(request.body);

      await authService.changePassword(
        request.user!.id,
        input.currentPassword,
        input.newPassword,
        actorFromRequest(request),
      );

      // Mudar a password fecha todas as sessões, incluindo esta.
      return reply.status(204).send();
    },
  );

  app.post('/api/auth/logout-all', { preHandler: requireAuth }, async (request) => {
    const closed = await authService.logoutEverywhere(
      request.user!.id,
      actorFromRequest(request),
    );

    return { sessionsClosed: closed };
  });

  // ── Gestão de utilizadores — só ADMIN e OWNER ─────────────────────────────

  app.get('/api/users', { preHandler: authenticated('ADMIN') }, async () => {
    const users = await usersRepo.listUsers();

    return {
      data: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.is_active,
        lastLoginAt: user.last_login_at?.toISOString() ?? null,
        createdAt: user.created_at.toISOString(),
      })),
    };
  });

  app.post('/api/users', { preHandler: authenticated('ADMIN') }, async (request, reply) => {
    const input = createUserSchema.parse(request.body);

    // Só o dono do sistema pode criar outro dono. Sem isto, um administrador
    // podia promover-se a si próprio criando uma conta OWNER.
    if (input.role === 'OWNER' && request.user!.role !== 'OWNER') {
      throw AppError.forbidden('Apenas o proprietário pode criar outro proprietário.');
    }

    const user = await authService.createUser(input, actorFromRequest(request));
    return reply.status(201).send(user);
  });
}
