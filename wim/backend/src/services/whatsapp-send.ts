/**
 * Enviar uma mensagem pela Cloud API da Meta.
 *
 * Isolado atrás de uma interface pequena, pela mesma razão do cliente da
 * Claude: a suite de testes não pode depender da rede nem de um número de
 * WhatsApp aprovado, e o resto do sistema não deve saber nada sobre a
 * forma dos payloads da Meta.
 *
 * A distinção entre falha transitória e definitiva repete-se aqui, e vale
 * tanto como no caminho da IA: trocá-las significa ou desistir de
 * mensagens que teriam passado, ou insistir para sempre em mensagens que
 * nunca vão passar.
 */
import { getEnv } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface SendTextInput {
  /** Número do destinatário, no formato que a Meta devolveu (`wa_id`). */
  to: string;
  body: string;
}

export interface SendResult {
  /** O `wamid` atribuído pela Meta. É o que liga a nossa linha à deles. */
  waMessageId: string;
}

export interface MessageSender {
  sendText(input: SendTextInput): Promise<SendResult>;
}

export class SendTransientError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SendTransientError';
  }
}

export class SendPermanentError extends Error {
  constructor(
    message: string,
    readonly code: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SendPermanentError';
  }
}

interface MetaResponse {
  messages?: Array<{ id?: string }>;
  error?: { message?: string; code?: number; type?: string };
}

export function createMetaSender(): MessageSender {
  return {
    async sendText(input: SendTextInput): Promise<SendResult> {
      const env = getEnv();

      if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
        throw new SendPermanentError(
          'Faltam as credenciais do WhatsApp (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID).',
          'WHATSAPP_NOT_CONFIGURED',
        );
      }

      const url =
        `${env.WHATSAPP_GRAPH_URL.replace(/\/$/, '')}/${env.WHATSAPP_API_VERSION}` +
        `/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.WHATSAPP_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: input.to,
            type: 'text',
            // `preview_url: false` evita que a Meta transforme um link da
            // resposta num cartão de pré-visualização que ninguém reviu.
            text: { preview_url: false, body: input.body },
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new SendTransientError('Não foi possível contactar a Meta.', error);
      } finally {
        clearTimeout(timeout);
      }

      const text = await response.text();

      if (!response.ok) {
        let detail = text.slice(0, 500);
        let code = String(response.status);

        try {
          const parsed = JSON.parse(text) as MetaResponse;
          if (parsed.error?.message) detail = parsed.error.message;
          if (parsed.error?.code !== undefined) code = String(parsed.error.code);
        } catch {
          // Resposta que não é JSON: fica o texto bruto, que já ajuda.
        }

        logger.warn({ status: response.status, code }, 'A Meta recusou o envio');

        // 429 e 5xx passam; 401 (token expirado) e 400 (número inválido,
        // janela de 24 horas fechada) não melhoram com insistência.
        if (response.status === 429 || response.status >= 500) {
          throw new SendTransientError(`Meta devolveu ${response.status}: ${detail}`);
        }

        throw new SendPermanentError(`Meta devolveu ${response.status}: ${detail}`, code);
      }

      let parsed: MetaResponse;
      try {
        parsed = JSON.parse(text) as MetaResponse;
      } catch (error) {
        throw new SendTransientError('A Meta devolveu algo que não é JSON.', error);
      }

      const waMessageId = parsed.messages?.[0]?.id;

      if (!waMessageId) {
        // Sem `wamid` não há como ligar as notificações de entrega à nossa
        // linha. Tratar como falha é mais honesto do que guardar meio envio.
        throw new SendTransientError('A Meta aceitou o envio mas não devolveu o identificador.');
      }

      return { waMessageId };
    },
  };
}

let sender: MessageSender | undefined;

export function getMessageSender(): MessageSender {
  sender ??= createMetaSender();
  return sender;
}

/** Apenas para testes: instala um duplo. */
export function setMessageSender(fake: MessageSender | undefined): void {
  sender = fake;
}
