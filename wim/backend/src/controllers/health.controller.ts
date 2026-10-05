/**
 * `GET /api/health` — o serviço está de pé e a base de dados responde?
 *
 * Devolve 200 quando tudo está bem e 503 quando a base de dados não responde,
 * para que um balanceador ou o Docker consigam decidir sozinhos.
 */
import type { FastifyInstance } from 'fastify';
import { getEnv, isAiEnabled, isServerless, isWhatsAppEnabled } from '../config/env.js';
import { checkDatabaseHealth } from '../database/pool.js';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: 'wim-backend';
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  environment: 'development' | 'test' | 'production';
  /**
   * Que integrações estão ligadas neste ambiente.
   *
   * Depois do deploy, a pergunta mais frequente é «porque é que o WhatsApp
   * não responde?» — e a resposta é quase sempre «está desligado neste
   * ambiente». Pôr isto na verificação de saúde evita ter de ir procurar às
   * variáveis de ambiente do painel da Vercel.
   */
  features: {
    whatsapp: boolean;
    ai: boolean;
  };
  database: {
    connected: boolean;
    latencyMs: number;
    serverVersion?: string;
    error?: string;
  };
}

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/api/health', async (_request, reply) => {
    const database = await checkDatabaseHealth();
    const env = getEnv();

    const body: HealthResponse = {
      status: database.connected ? 'ok' : 'degraded',
      service: 'wim-backend',
      version: process.env['npm_package_version'] ?? '0.1.0',
      // Numa função sem estado o tempo de vida do processo não diz nada sobre
      // o serviço — só sobre há quanto tempo esta invocação acordou.
      uptimeSeconds: isServerless(env) ? 0 : Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      features: {
        whatsapp: isWhatsAppEnabled(env),
        ai: isAiEnabled(env),
      },
      database,
    };

    return reply.status(database.connected ? 200 : 503).send(body);
  });
}
