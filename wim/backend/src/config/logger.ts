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

/**
 * Um logger para quem não tem um pedido à mão.
 *
 * Os controladores usam `request.log`, que já traz o identificador do
 * pedido. Mas o worker da fila e os serviços chamados por ele correm fora
 * de qualquer pedido, e escrever para `console` perderia a estrutura e a
 * lista de campos censurados.
 *
 * A criação é adiada até à primeira utilização, de propósito: construir o
 * pino no carregamento do módulo leria a configuração antes de os testes
 * terem oportunidade de a definir.
 */
let shared: FastifyBaseLogger | undefined;

function base(): FastifyBaseLogger {
  shared ??= createLogger();
  return shared;
}

export const logger = {
  debug: (...args: Parameters<FastifyBaseLogger['debug']>) => base().debug(...args),
  info: (...args: Parameters<FastifyBaseLogger['info']>) => base().info(...args),
  warn: (...args: Parameters<FastifyBaseLogger['warn']>) => base().warn(...args),
  error: (...args: Parameters<FastifyBaseLogger['error']>) => base().error(...args),
};

/** Apenas para testes: esquece o logger partilhado. */
export function resetLoggerCache(): void {
  shared = undefined;
}
