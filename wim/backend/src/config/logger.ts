/**
 * Logs estruturados (especificação, secção 25).
 *
 * Nada de segredos nos logs: a lista `redact` apaga automaticamente cabeçalhos
 * e campos sensíveis, mesmo que alguém os passe por engano.
 */
import type { FastifyBaseLogger } from 'fastify';
import { pino } from 'pino';
import { getEnv } from './env.js';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-hub-signature-256"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.password_hash',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.api_key',
  '*.apiKey',
  '*.secret',
];

/**
 * O tipo de retorno é o do Fastify (e não o `Logger` do pino) de propósito:
 * caso contrário o `FastifyInstance` resultante fica com um genérico
 * diferente do predefinido e deixa de ser compatível com os plugins.
 */
export function createLogger(): FastifyBaseLogger {
  const env = getEnv();

  return pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    base: { service: 'wim-backend', env: env.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
