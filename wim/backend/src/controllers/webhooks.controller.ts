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
import { getEnv, isWhatsAppEnabled } from '../config/env.js';
import { webhookVerifySchema, webhookEventSchema } from '../validators/whatsapp.validators.js';
import { compareTimingSafe } from '../middleware/whatsapp-webhook.js';
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

    // Comparação em tempo constante: um `!==` devolveria a resposta mais
    // depressa quanto mais cedo os caracteres divergissem, e isso chega
    // para adivinhar o token carácter a carácter.
    const expected = env.WHATSAPP_VERIFY_TOKEN ?? '';

    if (!compareTimingSafe(verification.data['hub.verify_token'], expected)) {
      request.log.warn('Handshake do webhook recusado: verify token inválido');
      throw AppError.unauthorized('Verify token inválido.');
    }

    // Meta espera o challenge na response
    return reply.status(200).send(verification.data['hub.challenge']);
  });

  /**
   * POST /api/webhooks/whatsapp
   *
   * Onde chegam as mensagens dos clientes. O middleware já validou a
   * assinatura HMAC; aqui valida-se a forma e processa-se o lote.
   *
   * A regra que a Meta impõe: responder 200 em menos de cinco segundos. Se
   * não responder, ou responder com erro, ela reenvia o mesmo lote até sete
   * vezes — e é por isso que a idempotência não é um extra, é o que impede
   * o cliente de aparecer sete vezes na conversa.
   */
  app.post('/api/webhooks/whatsapp', async (request, reply) => {
    const parsed = webhookEventSchema.safeParse(request.body);

    if (!parsed.success) {
      // 200 de propósito: se o payload não tem a forma esperada, reenviá-lo
      // sete vezes não vai mudar nada — só adia o problema. Fica o log, com
      // o corpo recebido, que é o que permite perceber o que mudou do lado
      // da Meta.
      request.log.error(
        { issues: parsed.error.issues, body: request.body },
        'Webhook do WhatsApp com formato inesperado',
      );
      return reply.status(200).send({ ok: true });
    }

    // Esperar que o lote fique guardado antes de responder.
    //
    // A alternativa — responder 200 e processar a seguir — parece atractiva
    // por causa do limite de cinco segundos da Meta, mas troca um problema
    // visível por um invisível:
    //
    //   • numa função serverless o processo é congelado assim que a
    //     resposta sai, e o trabalho pendente morre a meio;
    //   • num servidor permanente, um reinício no momento errado tem o
    //     mesmo efeito;
    //   • em ambos os casos já respondemos 200, por isso a Meta considera o
    //     evento entregue e nunca mais o reenvia. A mensagem do cliente
    //     desaparece sem deixar rasto.
    //
    // O que fazemos aqui são algumas escritas na base de dados: dezenas de
    // milissegundos, muito longe dos cinco segundos. Quando a análise pela
    // IA entrar (FASE 8) — essa sim, lenta — o caminho certo é uma fila de
    // trabalho, e não uma promessa solta.
    try {
      const result = await whatsappService.processWebhookEvent(parsed.data);
      request.log.info(result, 'Webhook do WhatsApp processado');
    } catch (error) {
      // 500 faz a Meta reenviar, que é exactamente o que queremos: alguma
      // coisa ficou por guardar. O reenvio não duplica — as mensagens já
      // guardadas são reconhecidas e ignoradas.
      request.log.error({ err: error }, 'Falha ao processar o webhook do WhatsApp');
      return reply.status(500).send({ ok: false });
    }

    return reply.status(200).send({ ok: true });
  });
}
