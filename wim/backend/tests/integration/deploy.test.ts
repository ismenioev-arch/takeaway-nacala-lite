/**
 * O que tem de ser verdade para o sistema poder ir para o ar antes de ter
 * conta do WhatsApp Business e chave da Anthropic.
 *
 * A promessa é esta: o painel funciona, a API funciona, e as integrações
 * desligadas dizem claramente que estão desligadas — em vez de falharem de
 * formas que parecem avaria.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { call, startTestApp } from '../helpers/api.js';
import type { ApiErrorBody } from '../helpers/api.js';
import type { HealthResponse } from '../../src/controllers/health.controller.js';
import { closePool } from '../../src/database/pool.js';

describe('prontidão para deploy', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  describe('GET /api/health', () => {
    it('diz que integrações estão ligadas neste ambiente', async () => {
      const response = await call<HealthResponse>(app, { method: 'GET', url: '/api/health' });

      expect(response.status).toBe(200);
      // Nos testes nenhuma credencial está configurada — tal como num
      // primeiro deploy.
      expect(response.body.features).toEqual({ whatsapp: false, ai: false });
      expect(response.body.environment).toBe('test');
    });

    it('continua a reportar o estado da base de dados', async () => {
      const response = await call<HealthResponse>(app, { method: 'GET', url: '/api/health' });

      expect(response.body.database.connected).toBe(true);
      expect(response.body.status).toBe('ok');
    });
  });

  describe('webhook do WhatsApp com a integração desligada', () => {
    // 503 e não 404: o endereço está certo, a funcionalidade é que não está
    // ligada. Responder 404 mandaria quem está a configurar a Meta procurar
    // um erro de URL que não existe.
    it('recusa o handshake de verificação com 503', async () => {
      const response = await call<ApiErrorBody>(app, {
        method: 'GET',
        url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=123',
      });

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(response.body.error.message).toContain('WHATSAPP_ENABLED');
    });

    it('recusa eventos com 503, sem os processar', async () => {
      const response = await call<ApiErrorBody>(app, {
        method: 'POST',
        url: '/api/webhooks/whatsapp',
        payload: { object: 'whatsapp_business_account', entry: [] },
      });

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('não afecta as restantes rotas', async () => {
      const response = await call(app, { method: 'GET', url: '/api/health' });
      expect(response.status).toBe(200);
    });
  });
});
