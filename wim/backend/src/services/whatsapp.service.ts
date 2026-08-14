/**
 * Serviço WhatsApp — processamento de eventos recebidos pela Cloud API.
 *
 * Responsabilidades:
 * - Extrair e normalizar contactos e mensagens do payload da Meta
 * - Criar/atualizar conversas quando primeira mensagem chega
 * - Armazenar mensagens com idempotência via wa_message_id
 * - Registar eventos processados na tabela webhook_events
 */
import * as contactsRepo from '../repositories/contacts.repository.js';
import * as conversationsRepo from '../repositories/conversations.repository.js';
import * as messagesRepo from '../repositories/messages.repository.js';
import * as webhookEventsRepo from '../repositories/webhook-events.repository.js';
import * as aiAnalysisService from './ai-analysis.service.js';
import type { WebhookEvent, WebhookContact, WebhookMessage } from '../validators/whatsapp.validators.js';

/**
 * Processa um webhook recebido da Meta.
 *
 * Idempotência: cada evento é registado em webhook_events(provider, external_id).
 * Se o evento já existe (mesmo que parcialmente processado), a função sai cedo.
 */
export async function processWebhookEvent(event: WebhookEvent): Promise<void> {
  for (const entry of event.entry) {
    for (const change of entry.changes) {
      // Só processamos eventos de mensagens (agora) e status (depois)
      if (change.field !== 'messages') {
        continue;
      }

      const value = change.value;

      // Extrair metadata
      const { display_phone_number: businessPhone, phone_number_id: phoneNumberId } = value.metadata;

      // Processar cada contacto + mensagem
      const contacts = value.contacts ?? [];
      const messages = value.messages ?? [];

      for (const contact of contacts) {
        for (const message of messages) {
          // Verificar idempotência antes de fazer qualquer coisa
          const externalId = message.id; // wamid.XXX
          const existingEvent = await webhookEventsRepo.findByExternalId('WHATSAPP', externalId);

          if (existingEvent) {
            // Evento já processado — sair
            continue;
          }

          try {
            await processMessage(
              contact,
              message,
              businessPhone,
              phoneNumberId,
              externalId,
            );

            // Registar como processado (sucesso)
            await webhookEventsRepo.insert({
              provider: 'WHATSAPP',
              externalId,
              status: 'SUCCESS',
              rawPayload: { message, contact },
            });
          } catch (error) {
            // Registar como falhado, mas não falhar o processamento
            await webhookEventsRepo.insert({
              provider: 'WHATSAPP',
              externalId,
              status: 'FAILED',
              rawPayload: { message, contact },
              errorMessage: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      }
    }
  }
}

/**
 * Processa uma mensagem individual recebida de um contacto.
 */
async function processMessage(
  contact: WebhookContact,
  message: WebhookMessage,
  businessPhone: string,
  phoneNumberId: string,
  waMessageId: string,
): Promise<void> {
  const { wa_id, profile } = contact;

  // 1. Criar ou obter contacto
  let contactId: string;
  const existing = await contactsRepo.findContactByWaId(wa_id);

  if (existing) {
    contactId = existing.id;
  } else {
    const newContact = await contactsRepo.insertContact({
      waId: wa_id,
      phone: `+${wa_id}`,
      profileName: profile.name,
      displayName: profile.name,
      category: 'PROSPECT', // Novo contacto é sempre prospect no início
    });
    contactId = newContact.id;
  }

  // 2. Criar ou obter conversa aberta
  let conversationId: string;
  const existingConversation = await conversationsRepo.findOpenByContactId(contactId);

  if (existingConversation) {
    conversationId = existingConversation.id;
  } else {
    const newConversation = await conversationsRepo.insertConversation({
      contactId,
      status: 'OPEN',
      priority: 'NORMAL', // A prioridade é reavaliada depois pela IA (FASE 8)
    });
    conversationId = newConversation.id;
  }

  // 3. Armazenar mensagem (com idempotência via wa_message_id)
  // Se a mensagem já existe, a INSERT falha com UNIQUE constraint
  // Mas como já verificámos webhook_events, isto não deve acontecer
  try {
    const messageId = await messagesRepo.insertMessage({
      conversationId,
      contactId,
      direction: 'INBOUND',
      waMessageId, // Idempotência: único por conversa
      type: 'text',
      body: message.text.body,
      status: 'RECEIVED',
      waTimestamp: new Date(parseInt(message.timestamp) * 1000),
      raw: message,
    });

    // Incrementar contador de não lidas
    await conversationsRepo.incrementUnreadCount(conversationId, 1);

    // Analisar com IA em background (não bloqueia a resposta)
    // Deixar a IA registar seus próprios erros se falhar
    aiAnalysisService.analyzeInboundMessage(messageId).catch((error) => {
      console.error('Erro em análise de IA:', error);
    });
  } catch (error) {
    // Se a mensagem já existe (duplicado mínimo), ignorar
    const errorMsg = error instanceof Error ? error.message : '';
    if (!errorMsg.includes('unique') && !errorMsg.includes('constraint')) {
      throw error;
    }
  }
}
