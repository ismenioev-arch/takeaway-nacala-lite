/**
 * Recepção de eventos da WhatsApp Business Cloud API (FASES 6 e 7).
 *
 * O que entra aqui já passou pela validação da assinatura (middleware) e
 * pela validação da forma (Zod). O que falta é o trabalho difícil: traduzir
 * o lote da Meta em contactos, conversas e mensagens, **sem duplicar e sem
 * perder nada**.
 *
 * Três decisões estruturais, cada uma a corrigir uma forma concreta de
 * perder mensagens de clientes:
 *
 * 1. **Uma mensagem de cada vez, identificada pelo seu `wamid`.** A versão
 *    anterior percorria contactos × mensagens: num lote com dois clientes e
 *    três mensagens, produzia seis combinações e atribuía mensagens ao
 *    cliente errado. Agora cada mensagem diz quem a enviou (`from`) e é esse
 *    o contacto usado.
 *
 * 2. **Cada mensagem é uma unidade independente.** Uma falha na terceira
 *    mensagem não impede as outras quatro de serem guardadas. No fim, se
 *    alguma falhou, o erro sobe — a Meta reenvia o lote e a idempotência
 *    garante que só as que faltam são processadas.
 *
 * 3. **Transacção por mensagem.** Contacto, conversa, mensagem e contador de
 *    não lidas entram juntos ou não entram. Sem isto, uma falha a meio
 *    deixaria uma conversa criada e vazia no painel.
 */
import { withTransaction, type Queryable } from '../database/pool.js';
import * as contactsRepo from '../repositories/contacts.repository.js';
import * as conversationsRepo from '../repositories/conversations.repository.js';
import * as messagesRepo from '../repositories/messages.repository.js';
import * as webhookEventsRepo from '../repositories/webhook-events.repository.js';
import { mapDeliveryStatus, normalizeMessage } from './whatsapp-normalize.js';
import type {
  WebhookContact,
  WebhookEvent,
  WebhookMessage,
  WebhookStatus,
} from '../validators/whatsapp.validators.js';

/** O que aconteceu ao lote. Serve para o log e para os testes. */
export interface WebhookProcessingResult {
  /** Mensagens novas guardadas. */
  received: number;
  /** Eventos que já tinham sido processados antes. */
  duplicates: number;
  /** Actualizações de estado aplicadas a mensagens nossas. */
  statusUpdates: number;
  /** Mensagens que não conseguimos processar, com o motivo. */
  failures: Array<{ externalId: string; reason: string }>;
}

/**
 * Erro lançado quando pelo menos uma mensagem do lote não pôde ser
 * guardada. Faz o webhook responder 500 para a Meta reenviar.
 */
export class WebhookProcessingError extends Error {
  readonly result: WebhookProcessingResult;

  constructor(result: WebhookProcessingResult) {
    const motivos = result.failures.map((f) => `${f.externalId}: ${f.reason}`).join('; ');
    super(`${result.failures.length} evento(s) do webhook falharam — ${motivos}`);
    this.name = 'WebhookProcessingError';
    this.result = result;
  }
}

export async function processWebhookEvent(
  event: WebhookEvent,
  options: { signatureValid?: boolean } = {},
): Promise<WebhookProcessingResult> {
  const signatureValid = options.signatureValid ?? true;

  const result: WebhookProcessingResult = {
    received: 0,
    duplicates: 0,
    statusUpdates: 0,
    failures: [],
  };

  for (const entry of event.entry) {
    for (const change of entry.changes) {
      // Subscrevemos vários campos na Meta; só este traz conversas.
      if (change.field !== 'messages') continue;

      const value = change.value;

      // Quem é quem neste lote. O nome de perfil vem na lista `contacts` e
      // a mensagem traz apenas o número — é por aqui que se ligam os dois.
      const contactsByWaId = new Map<string, WebhookContact>();
      for (const contact of value.contacts ?? []) {
        contactsByWaId.set(contact.wa_id, contact);
      }

      for (const message of value.messages ?? []) {
        await handleMessage(message, contactsByWaId.get(message.from), signatureValid, result);
      }

      for (const status of value.statuses ?? []) {
        await handleStatus(status, signatureValid, result);
      }
    }
  }

  if (result.failures.length > 0) {
    throw new WebhookProcessingError(result);
  }

  return result;
}

async function handleMessage(
  message: WebhookMessage,
  contact: WebhookContact | undefined,
  signatureValid: boolean,
  result: WebhookProcessingResult,
): Promise<void> {
  const externalId = message.id;

  const eventId = await webhookEventsRepo.claimEvent({
    externalId,
    payload: { message, contact },
    signatureValid,
  });

  if (eventId === null) {
    result.duplicates += 1;
    return;
  }

  try {
    await withTransaction((tx) => persistInboundMessage(message, contact, tx));
    await webhookEventsRepo.markProcessed(eventId);
    result.received += 1;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await webhookEventsRepo.markFailed(eventId, reason);
    result.failures.push({ externalId, reason });
  }
}

async function persistInboundMessage(
  message: WebhookMessage,
  contact: WebhookContact | undefined,
  tx: Queryable,
): Promise<void> {
  const waId = message.from;
  const profileName = contact?.profile?.name ?? null;

  // ── 1. O contacto ────────────────────────────────────────────────────────
  const existingContact = await contactsRepo.findContactByWaId(waId, tx);

  const contactId = existingContact
    ? existingContact.id
    : (
        await contactsRepo.insertContact(
          {
            waId,
            // A Meta usa o número internacional sem o «+». A nossa coluna é E.164.
            phone: `+${waId}`,
            profileName,
            displayName: profileName,
            // Quem escreve pela primeira vez ainda não é cliente; a
            // classificação certa vem depois, de quem atende.
            category: 'PROSPECT',
          },
          tx,
        )
      ).id;

  // ── 2. A conversa ────────────────────────────────────────────────────────
  const openConversation = await conversationsRepo.findOpenByContactId(contactId, tx);

  const conversationId = openConversation
    ? openConversation.id
    : (
        await conversationsRepo.insertConversation(
          { contactId, status: 'OPEN', priority: 'NORMAL' },
          tx,
        )
      ).id;

  // ── 3. A mensagem ────────────────────────────────────────────────────────
  const normalized = normalizeMessage(message);

  const inserted = await messagesRepo.insertInboundMessage(
    {
      conversationId,
      contactId,
      waMessageId: message.id,
      type: normalized.type,
      body: normalized.body,
      caption: normalized.caption,
      mediaId: normalized.mediaId,
      mediaMime: normalized.mediaMime,
      mediaSha256: normalized.mediaSha256,
      waTimestamp: new Date(Number(message.timestamp) * 1000),
      raw: message,
    },
    tx,
  );

  // Se a mensagem já lá estava, o contador não pode subir outra vez. Pode
  // acontecer quando o registo do evento foi limpo mas a mensagem não.
  if (inserted) {
    await conversationsRepo.incrementUnreadCount(conversationId, 1, tx);
  }
}

async function handleStatus(
  status: WebhookStatus,
  signatureValid: boolean,
  result: WebhookProcessingResult,
): Promise<void> {
  const mapped = mapDeliveryStatus(status.status);

  // Estados que não nos dizem nada de novo (`accepted`, por exemplo) são
  // ignorados sem ocupar espaço na tabela de eventos.
  if (mapped === null) return;

  // A chave de idempotência inclui o estado: a mesma mensagem recebe
  // `sent`, `delivered` e `read`, e as três têm de passar.
  const externalId = `${status.id}:${mapped}`;

  const eventId = await webhookEventsRepo.claimEvent({
    externalId,
    payload: status,
    signatureValid,
  });

  if (eventId === null) {
    result.duplicates += 1;
    return;
  }

  try {
    const firstError = status.errors?.[0];

    const changed = await messagesRepo.applyDeliveryStatus({
      waMessageId: status.id,
      status: mapped,
      errorCode: firstError?.code === undefined ? null : String(firstError.code),
      errorDetail: firstError?.message ?? firstError?.title ?? null,
    });

    await webhookEventsRepo.markProcessed(eventId);
    if (changed) result.statusUpdates += 1;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await webhookEventsRepo.markFailed(eventId, reason);
    result.failures.push({ externalId, reason });
  }
}
