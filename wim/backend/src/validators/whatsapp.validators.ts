/**
 * Validadores para webhooks do WhatsApp Business Cloud API.
 *
 * A validação é em duas etapas:
 * 1. Inicial: GET /api/webhooks/whatsapp — Meta envia modo_verificacao e token
 * 2. Eventos: POST /api/webhooks/whatsapp — Meta envia mensagens e eventos
 */
import { z } from 'zod';

/** Pedido GET inicial da Meta para verificar o webhook (handshake). */
export const webhookVerifySchema = z.object({
  'hub.mode': z.literal('subscribe'),
  'hub.challenge': z.string(),
  'hub.verify_token': z.string(),
});

export type WebhookVerifyRequest = z.infer<typeof webhookVerifySchema>;

/** Um contacto que enviou a mensagem. */
const contactSchema = z.object({
  profile: z.object({
    name: z.string(),
  }),
  wa_id: z.string(),
});

/** Uma mensagem de texto recebida. */
const textMessageSchema = z.object({
  from: z.string(),
  id: z.string(), // wamid.XXX
  timestamp: z.string(),
  type: z.literal('text'),
  text: z.object({
    body: z.string(),
  }),
});

/** Suporta texto por enquanto. Outros tipos (media, location, etc) chegam nas fases 7+. */
const messageSchema = textMessageSchema;

/** Um valor de mudança — o que realmente contém a mensagem/evento. */
const changeValueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    display_phone_number: z.string(),
    phone_number_id: z.string(),
    webhook_id: z.string().optional(),
  }),
  contacts: z.array(contactSchema).optional(),
  messages: z.array(messageSchema).optional(),
  statuses: z.array(z.any()).optional(), // Delivery statuses — ignorar por enquanto
});

/** Uma mudança num campo. */
const changeSchema = z.object({
  value: changeValueSchema,
  field: z.enum(['messages', 'message_template_status_update', 'message_template_quality_update']),
});

/** Uma entrada com alterações. */
const entrySchema = z.object({
  id: z.string(),
  changes: z.array(changeSchema),
});

/** Webhook completo do WhatsApp. */
export const webhookEventSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(entrySchema),
  timestamp: z.string(),
});

export type WebhookEvent = z.infer<typeof webhookEventSchema>;
export type WebhookMessage = z.infer<typeof textMessageSchema>;
export type WebhookContact = z.infer<typeof contactSchema>;
