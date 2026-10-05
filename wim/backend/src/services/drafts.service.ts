/**
 * Aprovar, editar, cancelar e enviar — o lado humano do ciclo.
 *
 * É aqui que a promessa da secção 3 da especificação se cumpre ou se
 * quebra: *a IA recomenda, a pessoa decide.* A FASE 8 preparou os
 * rascunhos; esta fase é a única porta por onde um deles pode chegar ao
 * cliente, e toda ela exige um utilizador identificado.
 *
 * A sequência de um envio é a parte que merece atenção:
 *
 *   1. aprovar e registar a mensagem de saída — **tudo numa transacção**;
 *   2. só depois falar com a Meta;
 *   3. numa segunda transacção, registar o que aconteceu.
 *
 * Gravar antes de enviar parece a ordem errada, e é a certa. Se o processo
 * morrer entre os passos 2 e 3, fica uma linha `APPROVED` sem
 * `wa_message_id`: visível, estranha, investigável. A ordem inversa
 * deixaria uma mensagem no telemóvel do cliente de que não há registo
 * nenhum — e isso ninguém descobre.
 */
import { getEnv, isWhatsAppEnabled } from '../config/env.js';
import { getPool, withTransaction } from '../database/pool.js';
import { AppError } from '../middleware/errors.js';
import type { AiDraftRow } from '../models/domain.js';
import * as draftsRepo from '../repositories/drafts.repository.js';
import * as messagesRepo from '../repositories/messages.repository.js';
import * as analysisRepo from '../repositories/analysis.repository.js';
import { logger } from '../config/logger.js';
import { AUDIT_ACTIONS, recordAudit, type Actor } from './audit.service.js';
import {
  getMessageSender,
  SendPermanentError,
  SendTransientError,
} from './whatsapp-send.js';

/** Estados a partir dos quais ainda se pode decidir alguma coisa. */
const DECIDABLE = ['DRAFT', 'EDITED'] as const;

function assertDecidable(draft: AiDraftRow): void {
  if ((DECIDABLE as readonly string[]).includes(draft.status)) return;

  // Mensagens concretas: quem está no painel precisa de saber se chegou
  // tarde, se alguém já tratou disto, ou se está a olhar para o ecrã errado.
  const motivo: Record<string, string> = {
    APPROVED: 'Este rascunho já foi aprovado e está a ser enviado.',
    SENT: 'Esta resposta já foi enviada ao cliente.',
    CANCELLED: 'Este rascunho foi cancelado.',
    FAILED: 'Este rascunho falhou no envio. Veja o erro antes de tentar de novo.',
  };

  throw AppError.conflict(motivo[draft.status] ?? 'Este rascunho já não pode ser alterado.');
}

export async function listPending(limit?: number): Promise<draftsRepo.DraftWithContextRow[]> {
  return draftsRepo.listPendingDrafts(limit);
}

export async function getDraft(id: string): Promise<draftsRepo.DraftWithContextRow> {
  const draft = await draftsRepo.findDraftById(id);
  if (!draft) throw AppError.notFound('Rascunho não encontrado.');

  return draft;
}

/**
 * Guarda a edição de uma pessoa.
 *
 * O texto da IA fica intacto em `content`; a edição vai para
 * `edited_content`. Assim continua a ser possível, meses depois,
 * comparar o que a IA propôs com o que a empresa realmente disse — que é
 * a única forma honesta de avaliar se a IA está a ajudar.
 */
export async function editDraft(
  id: string,
  editedContent: string,
  actor: Actor,
): Promise<AiDraftRow> {
  const existing = await draftsRepo.findDraftById(id);
  if (!existing) throw AppError.notFound('Rascunho não encontrado.');
  assertDecidable(existing);

  const updated = await draftsRepo.saveEdit(id, editedContent);
  if (!updated) throw AppError.conflict('O rascunho mudou de estado entretanto. Recarregue.');

  await recordAudit({
    action: AUDIT_ACTIONS.draftEdited,
    entityType: 'ai_draft',
    entityId: id,
    oldValue: { content: existing.edited_content ?? existing.content },
    newValue: { content: editedContent },
    actor,
  });

  return updated;
}

export async function cancelDraft(id: string, actor: Actor): Promise<AiDraftRow> {
  const existing = await draftsRepo.findDraftById(id);
  if (!existing) throw AppError.notFound('Rascunho não encontrado.');
  assertDecidable(existing);

  const updated = await draftsRepo.cancelDraft(id);
  if (!updated) throw AppError.conflict('O rascunho mudou de estado entretanto. Recarregue.');

  await recordAudit({
    action: AUDIT_ACTIONS.draftCancelled,
    entityType: 'ai_draft',
    entityId: id,
    oldValue: { status: existing.status },
    newValue: { status: 'CANCELLED' },
    actor,
  });

  return updated;
}

export interface SendOutcome {
  draft: AiDraftRow;
  messageId: string;
  waMessageId: string;
}

/**
 * Aprova e envia. A única porta para o cliente.
 *
 * Exige sempre `userId`: não há caminho neste código que envie sem uma
 * pessoa identificada, e mesmo que houvesse, a constraint
 * `ai_drafts_approved_requires_human` recusava a escrita.
 */
export async function sendDraft(
  id: string,
  userId: string,
  actor: Actor,
  options: { content?: string } = {},
): Promise<SendOutcome> {
  if (!isWhatsAppEnabled()) {
    throw AppError.serviceUnavailable(
      'A integração com o WhatsApp está desligada neste ambiente, por isso não é possível enviar.',
    );
  }

  const context = await draftsRepo.findDraftById(id);
  if (!context) throw AppError.notFound('Rascunho não encontrado.');
  assertDecidable(context);

  // ── Passo 1: aprovar e registar a saída, numa transacção ──────────────
  const prepared = await withTransaction(async (tx) => {
    // Relê com tranca: entre a leitura acima e aqui, outra pessoa pode ter
    // carregado no mesmo botão.
    const locked = await draftsRepo.lockDraft(id, tx);
    if (!locked) throw AppError.notFound('Rascunho não encontrado.');
    assertDecidable(locked);

    // Uma edição enviada junto com o clique conta como edição: fica
    // registada antes da aprovação, e não se perde o que a IA propôs.
    const body = (options.content ?? locked.edited_content ?? locked.content).trim();
    if (body === '') throw AppError.badRequest('Não é possível enviar uma resposta vazia.');

    if (options.content !== undefined && options.content.trim() !== locked.content.trim()) {
      await tx.query(`UPDATE ai_drafts SET edited_content = $2 WHERE id = $1`, [id, body]);
    }

    const approved = await draftsRepo.approveDraft(id, userId, tx);
    if (!approved) throw AppError.conflict('Não foi possível aprovar o rascunho.');

    const message = await messagesRepo.insertOutboundMessage(
      {
        conversationId: locked.conversation_id,
        contactId: context.contact_id,
        body,
        sentByUserId: userId,
      },
      tx,
    );

    return { body, message, approved };
  });

  await recordAudit({
    action: AUDIT_ACTIONS.draftApproved,
    entityType: 'ai_draft',
    entityId: id,
    newValue: { approved_by: userId, message_id: prepared.message.id },
    actor,
  });

  // ── Passo 2: a rede ───────────────────────────────────────────────────
  let waMessageId: string;
  try {
    const result = await getMessageSender().sendText({
      to: context.contact_wa_id,
      body: prepared.body,
    });
    waMessageId = result.waMessageId;
  } catch (error) {
    const transient = error instanceof SendTransientError;
    const code =
      error instanceof SendPermanentError
        ? error.code
        : transient
          ? 'META_TEMPORARIAMENTE_INDISPONIVEL'
          : 'ERRO_INESPERADO';
    const detail = error instanceof Error ? error.message : String(error);

    // ── Passo 3a: o envio falhou, e isso não pode desaparecer ───────────
    await withTransaction(async (tx) => {
      await messagesRepo.markOutboundFailed(prepared.message.id, code, detail, tx);
      await draftsRepo.markDraftFailed(id, code, detail, tx);

      await analysisRepo.insertNotification(
        {
          type: 'SEND_FAILED',
          priority: 'IMPORTANTE',
          title: `Falha ao responder a ${context.contact_name ?? context.contact_phone}`,
          body: transient
            ? `${detail} — pode tentar enviar de novo.`
            : `${detail} — é preciso resolver isto antes de tentar outra vez.`,
          conversationId: context.conversation_id,
          messageId: prepared.message.id,
          contactId: context.contact_id,
        },
        tx,
      );
    });

    await recordAudit({
      action: AUDIT_ACTIONS.draftSendFailed,
      entityType: 'ai_draft',
      entityId: id,
      newValue: { code, detail, retryable: transient },
      actor,
    });

    logger.error({ draftId: id, code, transient }, 'Falha ao enviar resposta pelo WhatsApp');

    throw transient
      ? AppError.serviceUnavailable(
          `Não foi possível enviar agora: ${detail}. A resposta ficou guardada; tente de novo daqui a pouco.`,
        )
      : AppError.badGateway(`A Meta recusou o envio: ${detail}`);
  }

  // ── Passo 3b: correu bem ──────────────────────────────────────────────
  const sentDraft = await withTransaction(async (tx) => {
    await messagesRepo.markOutboundSent(prepared.message.id, waMessageId, tx);
    await draftsRepo.markDraftSent(id, prepared.message.id, tx);

    // A conversa passa a estar do lado do cliente: respondemos, agora
    // esperamos. E deixa de contar como não lida, porque acabámos de a ler.
    await tx.query(
      `UPDATE conversations
          SET last_outbound_at = now(),
              last_message_at  = now(),
              unread_count     = 0,
              status = CASE WHEN status IN ('NEW', 'OPEN', 'WAITING_HUMAN')
                            THEN 'WAITING_CUSTOMER'::conversation_status
                            ELSE status END
        WHERE id = $1`,
      [context.conversation_id],
    );

    // A mensagem do cliente fica fechada: foi analisada, houve rascunho,
    // e agora foi respondida.
    await messagesRepo.setMessageStatus(context.message_id, 'SENT', tx);

    const result = await tx.query<AiDraftRow>(`SELECT * FROM ai_drafts WHERE id = $1`, [id]);
    return result.rows[0]!;
  });

  await recordAudit({
    action: AUDIT_ACTIONS.draftSent,
    entityType: 'ai_draft',
    entityId: id,
    newValue: { wa_message_id: waMessageId, message_id: prepared.message.id },
    actor,
  });

  logger.info({ draftId: id, waMessageId }, 'Resposta enviada ao cliente');

  return { draft: sentDraft, messageId: prepared.message.id, waMessageId };
}

/** O que o painel precisa de saber sobre a fila de aprovações. */
export async function getPendingCount(): Promise<number> {
  return draftsRepo.countPendingDrafts(getPool());
}

/** A integração está ligada e é possível responder? */
export function canSend(): boolean {
  return isWhatsAppEnabled(getEnv());
}
