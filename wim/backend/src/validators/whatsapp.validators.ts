/**
 * Validadores para webhooks do WhatsApp Business Cloud API.
 *
 * A regra que governa este ficheiro: **ser rigoroso com o que precisamos e
 * tolerante com o resto.**
 *
 * A Meta acrescenta campos e tipos de mensagem sem avisar, e envia num só
 * pedido todas as mensagens acumuladas. Um esquema estrito transformaria
 * cada novidade — um autocolante, uma reacção, um campo novo — na perda de
 * um lote inteiro de mensagens de clientes, silenciosamente, porque o
 * webhook responde 200 na mesma.
 *
 * Por isso aqui só é obrigatório o que não dá para inventar: o identificador
 * da mensagem, quem a enviou e quando. O significado de cada tipo é decidido
 * depois, em `normalizeMessage`, onde é mais fácil de ler e de testar.
 */
import { z } from 'zod';

/** Pedido GET inicial da Meta para verificar o webhook (handshake). */
export const webhookVerifySchema = z.object({
  'hub.mode': z.literal('subscribe'),
  'hub.challenge': z.string(),
  'hub.verify_token': z.string(),
});

export type WebhookVerifyRequest = z.infer<typeof webhookVerifySchema>;

/** Um contacto que enviou mensagens neste lote. */
const contactSchema = z
  .object({
    wa_id: z.string().min(1),
    // Há contactos sem nome de perfil (quem o desactivou nas definições).
    profile: z.object({ name: z.string() }).partial().optional(),
  })
  .passthrough();

/** Media anexada a uma mensagem (imagem, documento, áudio, vídeo, autocolante). */
const mediaSchema = z
  .object({
    id: z.string().min(1),
    mime_type: z.string().optional(),
    sha256: z.string().optional(),
    caption: z.string().optional(),
    filename: z.string().optional(),
    voice: z.boolean().optional(),
  })
  .passthrough();

/**
 * Uma mensagem recebida.
 *
 * `type` é uma string livre e não um enum: um tipo desconhecido tem de
 * atravessar a validação para poder ser guardado como «não suportado». Se
 * fosse um enum, a mensagem seguinte — legítima, de um cliente real — caía
 * com ela.
 */
export const webhookMessageSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    timestamp: z.string().regex(/^\d+$/, 'deve ser um instante Unix em segundos'),
    type: z.string().min(1),

    text: z.object({ body: z.string() }).passthrough().optional(),

    image: mediaSchema.optional(),
    document: mediaSchema.optional(),
    audio: mediaSchema.optional(),
    video: mediaSchema.optional(),
    sticker: mediaSchema.optional(),

    location: z
      .object({
        latitude: z.number(),
        longitude: z.number(),
        name: z.string().optional(),
        address: z.string().optional(),
      })
      .passthrough()
      .optional(),

    contacts: z.array(z.unknown()).optional(),

    interactive: z
      .object({
        type: z.string().optional(),
        button_reply: z.object({ id: z.string(), title: z.string() }).partial().optional(),
        list_reply: z
          .object({ id: z.string(), title: z.string(), description: z.string() })
          .partial()
          .optional(),
      })
      .passthrough()
      .optional(),

    button: z.object({ text: z.string(), payload: z.string() }).partial().passthrough().optional(),

    reaction: z
      .object({ message_id: z.string(), emoji: z.string().optional() })
      .passthrough()
      .optional(),

    /** Presente quando a mensagem é resposta a outra. */
    context: z.object({ id: z.string() }).partial().passthrough().optional(),

    /** A Meta usa isto quando não conseguiu entregar-nos o conteúdo. */
    errors: z.array(z.unknown()).optional(),
  })
  .passthrough();

/**
 * Uma actualização de estado de mensagem que nós enviámos:
 * `sent` → `delivered` → `read`, ou `failed`.
 */
export const webhookStatusSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    timestamp: z.string().optional(),
    recipient_id: z.string().optional(),
    errors: z
      .array(
        z
          .object({
            code: z.union([z.number(), z.string()]).optional(),
            title: z.string().optional(),
            message: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

/** O conteúdo de uma alteração: é aqui que vêm as mensagens e os estados. */
const changeValueSchema = z
  .object({
    messaging_product: z.string().optional(),
    metadata: z
      .object({
        display_phone_number: z.string().optional(),
        phone_number_id: z.string().optional(),
      })
      .passthrough()
      .optional(),
    contacts: z.array(contactSchema).optional(),
    messages: z.array(webhookMessageSchema).optional(),
    statuses: z.array(webhookStatusSchema).optional(),
    errors: z.array(z.unknown()).optional(),
  })
  .passthrough();

/**
 * `field` é uma string livre, e não um enum, pela mesma razão de sempre: a
 * Meta subscreve campos novos (`message_template_status_update`,
 * `account_update`, …) e só nos interessa `messages`. Os outros são
 * ignorados pelo serviço, não rejeitados pelo validador.
 */
const changeSchema = z
  .object({
    field: z.string().min(1),
    value: changeValueSchema,
  })
  .passthrough();

const entrySchema = z
  .object({
    id: z.string().optional(),
    time: z.number().optional(),
    changes: z.array(changeSchema).default([]),
  })
  .passthrough();

/**
 * O envelope do webhook.
 *
 * Note-se o que **não** está aqui: um `timestamp` no topo. A versão anterior
 * exigia-o e os payloads reais da Meta não o têm — o que significava que
 * nenhum webhook verdadeiro teria passado a validação.
 */
export const webhookEventSchema = z
  .object({
    object: z.string().min(1),
    entry: z.array(entrySchema).default([]),
  })
  .passthrough();

export type WebhookEvent = z.infer<typeof webhookEventSchema>;
export type WebhookMessage = z.infer<typeof webhookMessageSchema>;
export type WebhookStatus = z.infer<typeof webhookStatusSchema>;
export type WebhookContact = z.infer<typeof contactSchema>;
