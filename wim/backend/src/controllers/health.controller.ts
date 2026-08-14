/**
 * `GET /api/health` — o serviço está de pé e a base de dados responde?
 *
 * Devolve 200 quando tudo está bem e 503 quando a base de dados não responde,
 * para que um balanceador ou o Docker consigam decidir sozinhos.
 */
import type { FastifyInstance } from 'fastify';
import { checkDatabaseHealth } from '../database/pool.js';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: 'wim-backend';
  version: string;
  uptimeSeconds: number;
  timestamp: string;
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

    const body: HealthResponse = {
      status: database.connected ? 'ok' : 'degraded',
      service: 'wim-backend',
      version: process.env['npm_package_version'] ?? '0.1.0',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      database,
    };

    return reply.status(database.connected ? 200 : 503).send(body);
  });
}
