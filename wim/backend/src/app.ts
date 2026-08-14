/**
 * Construção da aplicação Fastify.
 *
 * Separada de `server.ts` de propósito: os testes constroem a app e fazem
 * pedidos com `app.inject()`, sem abrir portas de rede.
 */
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { getEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { registerAuthRoutes } from './controllers/auth.controller.js';
import { registerContactRoutes } from './controllers/contacts.controller.js';
import { registerConversationRoutes } from './controllers/conversations.controller.js';
import { registerHealthRoutes } from './controllers/health.controller.js';
import {
  registerMessageRoutes,
  registerSearchRoutes,
} from './controllers/messages.controller.js';
import { registerErrorHandler } from './middleware/errors.js';
import { registerRawBodyParser } from './middleware/raw-body.js';
import { registerWhatsAppWebhookValidation } from './middleware/whatsapp-webhook.js';
import { registerWebhookRoutes } from './controllers/webhooks.controller.js';

/** Converte "15m" / "1h" / "30d" em milissegundos. */
export function durationToMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error(`Duração inválida: "${value}"`);

  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const factor = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];

  return amount * factor;
}

export async function buildApp(): Promise<FastifyInstance> {
  const env = getEnv();

  const app = Fastify({
    loggerInstance: createLogger(),
    trustProxy: true,
    // Um webhook da Meta é pequeno; recusar corpos grandes fecha uma via de abuso.
    bodyLimit: 1_048_576, // 1 MB
  });

  // O parser do corpo bruto tem de ser registado antes de qualquer rota.
  registerRawBodyParser(app);

  // O middleware de validação de webhook tem de ser registado antes do rate limit.
  registerWhatsAppWebhookValidation(app);

  await app.register(helmet, {
    // A API não serve HTML; o CSP por omissão do helmet só atrapalharia.
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((value) => value.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: durationToMs(env.RATE_LIMIT_WINDOW),
    // A verificação de saúde é chamada por sondas automáticas; não deve
    // consumir a quota dos utilizadores reais.
    allowList: (request) => request.url.split('?')[0] === '/api/health',
  });

  registerErrorHandler(app);

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerWebhookRoutes(app);
  registerContactRoutes(app);
  registerConversationRoutes(app);
  registerMessageRoutes(app);
  registerSearchRoutes(app);

  return app;
}
