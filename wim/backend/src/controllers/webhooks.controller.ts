/**
 * `/api/webhooks/whatsapp` — Webhook da Meta WhatsApp Business Cloud API.
 *
 * Duas operações:
 * 1. GET /api/webhooks/whatsapp — Handshake de verificação (Meta envia token)
 * 2. POST /api/webhooks/whatsapp — Eventos de mensagens (assinado com HMAC)
 *
 * A validação HMAC corre antes, no middleware registerWhatsAppWebhookValidation.
 */
import type { FastifyInstance } from 'fastify';
import { AppError } from '../middleware/errors.js';
import { getEnv } from '../config/env.js';
import { webhookVerifySchema, webhookEventSchema } from '../validators/whatsapp.validators.js';
import * as whatsappService from '../services/whatsapp.service.js';

export function registerWebhookRoutes(app: FastifyInstance): void {
  /**
   * GET /api/webhooks/whatsapp
   *
   * Meta envia isso durante o setup do webhook (test subscription).
   * Devemos responder com o challenge para confirmar que controlamos este URL.
   *
   * Operação idempotente — pública, sem autenticação.
   */
  app.get('/api/webhooks/whatsapp', async (request, reply) => {
    // Query string de verificação
    const verification = webhookVerifySchema.safeParse(request.query);

    if (!verification.success) {
      throw AppError.badRequest('Parâmetros de verificação do webhook inválidos.');
    }

    const env = getEnv();

    // Verificar token
    if (verification.data['hub.verify_token'] !== env.WHATSAPP_VERIFY_TOKEN) {
      throw AppError.unauthorized('Verify token inválido.');
    }

    // Meta espera o challenge na response
    return reply.status(200).send(verification.data['hub.challenge']);
  });

  /**
   * POST /api/webhooks/whatsapp
   *
   * Meta envia eventos reais aqui (mensagens, status updates, etc).
   * Cada evento é assinado com X-Hub-Signature-256 (validado no middleware).
   *
   * Responder rapidamente (< 5s) com 200 OK. Se falhar a processar,
   * a Meta tenta novamente (até 7 vezes).
   *
   * Idempotência:
   * - Cada evento tem um external_id único (wamid.XXX)
   * - Registamos em webhook_events(provider, external_id)
   * - Se já existe, saímos cedo
   */
  app.post('/api/webhooks/whatsapp', async (request, reply) => {
    // Validar payload
    const eventData = webhookEventSchema.safeParse(request.body);

    if (!eventData.success) {
      // Responder 200 mesmo com erro de validação (Meta sairia depois de N tentativas)
      // Mas logar para debugging
      request.log.error({ error: eventData.error }, 'Webhook payload inválido');
      return reply.status(200).send({ ok: true });
    }

    // Processar em background (não esperar que termine)
    // Respondemos imediatamente com 200
    processWebhookInBackground(eventData.data).catch((error) => {
      request.log.error('Erro ao processar webhook:', error);
    });

    return reply.status(200).send({ ok: true });
  });
}

/**
 * Processa o webhook fora do loop de requisição (background).
 */
async function processWebhookInBackground(event: typeof webhookEventSchema._type): Promise<void> {
  await whatsappService.processWebhookEvent(event);
}
