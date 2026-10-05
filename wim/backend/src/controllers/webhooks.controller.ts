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
import { getEnv, isServerless, isWhatsAppEnabled } from '../config/env.js';
import { webhookVerifySchema, webhookEventSchema } from '../validators/whatsapp.validators.js';
import * as whatsappService from '../services/whatsapp.service.js';

export function registerWebhookRoutes(app: FastifyInstance): void {
  /**
   * Enquanto a integração estiver desligada (`WHATSAPP_ENABLED=false`), as
   * duas rotas existem mas recusam-se a trabalhar.
   *
   * Responder 503 e não 404 é deliberado: 404 diria à Meta «este URL não
   * existe», o que levaria alguém a procurar um erro de configuração que não
   * existe. 503 diz a verdade — o endereço está certo, a funcionalidade é
   * que ainda não foi ligada.
   */
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/webhooks/whatsapp')) return;
    if (isWhatsAppEnabled()) return;

    throw AppError.serviceUnavailable(
      'A integração com o WhatsApp está desligada neste ambiente. ' +
        'Defina WHATSAPP_ENABLED=true e as credenciais da Meta para a activar.',
    );
  });

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

    // Num servidor permanente, responder primeiro e processar depois é a
    // melhor escolha: a Meta recebe o 200 em milissegundos e o trabalho
    // continua à vontade.
    //
    // Numa função sem estado isso perde mensagens. A Vercel congela o
    // processo no instante em que a resposta sai, e tudo o que ficou a meio
    // morre aí — sem erro, sem aviso, sem nova tentativa (porque já
    // respondemos 200 e a Meta considera o evento entregue). Por isso, em
    // serverless, esperamos.
    if (isServerless()) {
      try {
        await processWebhookInBackground(eventData.data);
      } catch (error) {
        // Devolver 500 faz a Meta tentar de novo (até 7 vezes), que é o que
        // queremos: o evento ainda não foi guardado. A idempotência por
        // `wa_message_id` garante que a repetição não duplica nada.
        request.log.error({ err: error }, 'Erro ao processar webhook');
        return reply.status(500).send({ ok: false });
      }

      return reply.status(200).send({ ok: true });
    }

    processWebhookInBackground(eventData.data).catch((error: unknown) => {
      request.log.error({ err: error }, 'Erro ao processar webhook');
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
