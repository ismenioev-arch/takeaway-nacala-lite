/**
 * Testes da aplicação HTTP.
 *
 * Usam `app.inject()`: exercitam o pipeline completo (parsers, middleware,
 * rotas, tratamento de erros) sem abrir portas de rede.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { closePool } from '../../src/database/pool.js';
import type { HealthResponse } from '../../src/controllers/health.controller.js';
import type { ErrorResponseBody } from '../../src/middleware/errors.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('GET /api/health', () => {
  it('responde 200 e confirma a ligação à base de dados', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);

    const body = response.json<HealthResponse>();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('wim-backend');
    expect(body.database.connected).toBe(true);
    expect(body.database.serverVersion).toContain('PostgreSQL');
    expect(body.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(() => new Date(body.timestamp)).not.toThrow();
  });
});

describe('tratamento de erros', () => {
  it('devolve 404 com a forma de erro padronizada', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nao-existe' });

    expect(response.statusCode).toBe(404);

    const body = response.json<ErrorResponseBody>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('/api/nao-existe');
    expect(body.error.requestId).toBeTruthy();
  });

  it('devolve 400 quando o corpo não é JSON válido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/nao-existe',
      headers: { 'content-type': 'application/json' },
      payload: '{ isto não é json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorResponseBody>().error.code).toBe('INVALID_JSON');
  });
});

describe('cabeçalhos de segurança', () => {
  it('aplica os cabeçalhos do helmet', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
  });

  it('responde ao pré-voo CORS da origem do frontend', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.statusCode).toBeLessThan(400);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});

describe('limite de pedidos', () => {
  it('não conta a verificação de saúde para a quota', async () => {
    // Sondas automáticas chamam /api/health constantemente; se contassem,
    // esgotariam a quota dos utilizadores reais.
    for (let i = 0; i < 20; i += 1) {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(200);
    }
  });

  it('devolve os cabeçalhos de quota nas rotas normais', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/qualquer-coisa' });
    expect(response.headers['x-ratelimit-limit']).toBeDefined();
  });
});
