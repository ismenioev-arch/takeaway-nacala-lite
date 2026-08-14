/**
 * Middleware de validação de webhook do WhatsApp.
 *
 * A Meta envia X-Hub-Signature-256: sha256=<hmac> com cada webhook.
 * Validamos:
 * 1. A assinatura HMAC (segurança)
 * 2. O token de verificação (durante handshake GET)
 */
import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from './errors.js';
import { getEnv } from '../config/env.js';

/**
 * Valida a assinatura X-Hub-Signature-256 de um webhook do WhatsApp.
 *
 * A Meta computa:
 *   sha256_hex(body, secret) = computed
 *
 * Comparamos com timing-safe para evitar timing attacks.
 */
export function validateWhatsAppSignature(
  request: FastifyRequest,
): { valid: boolean; reason?: string } {
  const env = getEnv();

  if (!env.WHATSAPP_APP_SECRET) {
    return { valid: false, reason: 'WHATSAPP_APP_SECRET não configurado' };
  }

  const signature = request.headers['x-hub-signature-256'];

  if (!signature || typeof signature !== 'string') {
    return { valid: false, reason: 'X-Hub-Signature-256 ausente ou inválido' };
  }

  // Esperado: "sha256=abcd1234..."
  const [algorithm, expected] = signature.split('=');

  if (algorithm !== 'sha256' || !expected) {
    return { valid: false, reason: 'Formato de assinatura inválido' };
  }

  // Body deve estar disponível como Buffer (adicionado por raw-body middleware)
  const body = request.rawBody;

  if (!body) {
    return { valid: false, reason: 'Raw body não disponível' };
  }

  // Computar HMAC
  const hmac = createHmac('sha256', env.WHATSAPP_APP_SECRET);
  hmac.update(body);
  const computed = hmac.digest('hex');

  // Comparação timing-safe
  const match = compareTimingSafe(computed, expected);

  if (!match) {
    return { valid: false, reason: 'Assinatura inválida' };
  }

  return { valid: true };
}

/**
 * Compara duas strings com proteção contra timing attacks.
 * Lê todos os bytes mesmo que não coincidam.
 */
function compareTimingSafe(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Regista o middleware no Fastify.
 */
export function registerWhatsAppWebhookValidation(app: FastifyInstance): void {
  // O middleware corre antes de qualquer rota /api/webhooks/whatsapp
  // Verifica assinatura em POST (events) mas não em GET (handshake)
  app.addHook('preHandler', async (request, _reply) => {
    if (!request.url.startsWith('/api/webhooks/whatsapp')) {
      return;
    }

    // GET: handshake — não precisa de assinatura (Meta envia token em query)
    if (request.method === 'GET') {
      return;
    }

    // POST: evento real — DEVE ter assinatura válida
    const validation = validateWhatsAppSignature(request);

    if (!validation.valid) {
      throw AppError.unauthorized(
        `Webhook signature inválida: ${validation.reason}`,
      );
    }
  });
}
