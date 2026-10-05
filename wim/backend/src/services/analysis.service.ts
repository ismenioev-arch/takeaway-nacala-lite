/**
 * A fila de análise: do «mensagem recebida» ao «rascunho à espera de uma pessoa».
 *
 * Este ficheiro é o passo 10 ao 17 da secção 6.3 da arquitectura. Três
 * decisões estruturais, todas aprendidas na fase anterior:
 *
 * 1. **A análise nunca corre dentro do webhook.** Uma chamada à Claude
 *    demora segundos; a Meta espera resposta em poucos. Misturar as duas
 *    coisas dá timeouts, reenvios e mensagens duplicadas. O webhook grava e
 *    responde; isto corre depois, noutro pedido.
 *
 * 2. **Uma mensagem de cada vez, reivindicada atomicamente.** Dois
 *    processos em paralelo — o cron e um clique no painel — nunca analisam
 *    a mesma mensagem duas vezes, porque a reivindicação é um `UPDATE` com
 *    `SKIP LOCKED`.
 *
 * 3. **Escrita toda numa transacção.** A análise, o rascunho, o estado da
 *    conversa e a notificação entram juntos ou não entra nada. Um rascunho
 *    órfão, sem a análise que o explica, seria pior do que mensagem
 *    nenhuma.
 */
import { getEnv, isAiEnabled } from '../config/env.js';
import { getPool, withTransaction, type Queryable } from '../database/pool.js';
import type { MessageRow } from '../models/domain.js';
import { comparePriority, type Priority } from '../models/enums.js';
import * as analysisRepo from '../repositories/analysis.repository.js';
import * as messagesRepo from '../repositories/messages.repository.js';
import { logger } from '../config/logger.js';
import { AUDIT_ACTIONS, recordAudit } from './audit.service.js';
import { decideAutomationLevel, type AutomationDecision } from './ai/automation.js';
import { AiPermanentError, AiTransientError, getAiClient } from './ai/client.js';
import { hasRegisteredFacts, loadAnalysisContext } from './ai/context.js';
import { buildSystemPrompt, buildUserPrompt } from './ai/prompt.js';
import { analysisResultSchema, PROMPT_VERSION, type AnalysisResult } from './ai/schema.js';

export type AnalysisOutcome =
  | { status: 'analyzed'; messageId: string; decision: AutomationDecision; result: AnalysisResult }
  /** Falhou, mas volta à fila: rede, limite de pedidos, função congelada. */
  | { status: 'retry'; messageId: string; reason: string }
  /** Falhou de vez: a mensagem fica marcada e passa a ser trabalho de uma pessoa. */
  | { status: 'failed'; messageId: string; reason: string };

/**
 * Analisa uma mensagem já reivindicada (estado `ANALYZING`).
 *
 * Não lança. Todos os caminhos devolvem um resultado, porque quem chama
 * está a processar um lote e uma mensagem problemática não pode levar as
 * outras à frente.
 */
export async function analyzeMessage(message: MessageRow): Promise<AnalysisOutcome> {
  const pool = getPool();

  let context;
  try {
    context = await loadAnalysisContext(message, pool);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await messagesRepo.markMessageAnalysisFailed(message.id, 'CONTEXT_UNAVAILABLE', reason, pool);
    return { status: 'failed', messageId: message.id, reason };
  }

  // ── Chamada ao modelo ──────────────────────────────────────────────────
  let completion;
  try {
    completion = await getAiClient().analyze({
      system: buildSystemPrompt(),
      user: buildUserPrompt(context),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    if (error instanceof AiTransientError) {
      // Volta à fila. A próxima passagem tenta de novo.
      await messagesRepo.releaseMessageToQueue(message.id, pool);
      logger.warn({ messageId: message.id, reason }, 'Análise adiada: falha transitória');
      return { status: 'retry', messageId: message.id, reason };
    }

    // Chave inválida, pedido recusado: insistir não resolve.
    await messagesRepo.markMessageAnalysisFailed(
      message.id,
      error instanceof AiPermanentError ? 'AI_REQUEST_REJECTED' : 'AI_UNEXPECTED_ERROR',
      reason,
      pool,
    );
    await recordAudit({
      action: AUDIT_ACTIONS.analysisFailed,
      entityType: 'message',
      entityId: message.id,
      newValue: { reason },
    });
    logger.error({ messageId: message.id, reason }, 'Análise falhou definitivamente');
    return { status: 'failed', messageId: message.id, reason };
  }

  // ── Validação (passo 12: nunca gravar lixo) ────────────────────────────
  const parsed = analysisResultSchema.safeParse(completion.data);

  if (!parsed.success) {
    // Pode ser um modelo mal configurado ou um prompt partido; em qualquer
    // dos casos repetir daria o mesmo resultado. Falha, com o payload
    // original guardado no detalhe para se perceber o que veio.
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('; ');

    await messagesRepo.markMessageAnalysisFailed(
      message.id,
      'AI_INVALID_RESPONSE',
      `${reason} | recebido: ${JSON.stringify(completion.data).slice(0, 1000)}`,
      pool,
    );
    await recordAudit({
      action: AUDIT_ACTIONS.analysisFailed,
      entityType: 'message',
      entityId: message.id,
      newValue: { reason, model: completion.model },
    });
    logger.error({ messageId: message.id, reason }, 'A IA devolveu uma análise inválida');
    return { status: 'failed', messageId: message.id, reason };
  }

  const result = parsed.data;

  // ── Passo 15: decide o código ──────────────────────────────────────────
  const decision = decideAutomationLevel({
    intent: result.intent,
    priority: result.priority,
    confidence: result.confidence,
    requiresHuman: result.requires_human,
    suggestedReply: result.suggested_reply,
    modelSaysMentionsPriceOrDeadline: result.mentions_price_or_deadline,
    modelSaysGrounded: result.grounded_in_registered_facts,
    globalAutomationEnabled: context.globalAutomationEnabled,
    confidenceThreshold: context.confidenceThreshold,
    hasRegisteredFacts: hasRegisteredFacts(context),
  });

  // ── Passos 13 a 17, tudo junto ou nada ─────────────────────────────────
  await withTransaction(async (tx) => {
    await analysisRepo.upsertAnalysis(
      {
        messageId: message.id,
        priority: result.priority,
        intent: result.intent,
        confidence: result.confidence,
        summary: result.summary,
        urgencyReason: result.urgency_reason,
        requiresHuman: result.requires_human,
        recommendedAction: result.recommended_action,
        model: completion.model,
        promptVersion: PROMPT_VERSION,
        tokensInput: completion.tokensInput,
        tokensOutput: completion.tokensOutput,
        latencyMs: completion.latencyMs,
        rawResponse: completion.data,
      },
      tx,
    );

    await updateConversationFromAnalysis(context.conversation.id, result, decision, tx);

    // Reanalisar substitui o rascunho pendente em vez de criar um segundo.
    await analysisRepo.cancelPendingDrafts(message.id, tx);

    await analysisRepo.insertDraft(
      {
        messageId: message.id,
        conversationId: context.conversation.id,
        automationLevel: decision.level,
        content: result.suggested_reply,
      },
      tx,
    );

    await messagesRepo.setMessageStatus(message.id, 'DRAFTED', tx);

    await notify(message, result, decision, tx);
  });

  await recordAudit({
    action: AUDIT_ACTIONS.analysisCompleted,
    entityType: 'message',
    entityId: message.id,
    newValue: {
      priority: result.priority,
      intent: result.intent,
      confidence: result.confidence,
      automation_level: decision.level,
      reason: decision.reason,
      model: completion.model,
      prompt_version: PROMPT_VERSION,
    },
  });

  logger.info(
    {
      messageId: message.id,
      priority: result.priority,
      intent: result.intent,
      level: decision.level,
      latencyMs: completion.latencyMs,
    },
    'Mensagem analisada',
  );

  return { status: 'analyzed', messageId: message.id, decision, result };
}

/**
 * Passo 14: a conversa herda o que a análise descobriu.
 *
 * A prioridade só sobe. Uma conversa urgente não desce a NORMAL porque a
 * mensagem seguinte foi «obrigado» — quem está a tratar de um problema
 * grave não o vê desaparecer da lista a meio.
 */
async function updateConversationFromAnalysis(
  conversationId: string,
  result: AnalysisResult,
  decision: AutomationDecision,
  tx: Queryable,
): Promise<void> {
  const current = await tx.query<{ priority: Priority; subject: string | null; status: string }>(
    `SELECT priority, subject, status FROM conversations WHERE id = $1 FOR UPDATE`,
    [conversationId],
  );

  const row = current.rows[0];
  if (!row) return;

  const priority =
    comparePriority(result.priority, row.priority) < 0 ? result.priority : row.priority;

  const subject = row.subject ?? result.summary.slice(0, 200);

  // Conversas fechadas ou arquivadas não são reabertas aqui: isso é uma
  // decisão de quem recebe a mensagem, e o webhook já trata disso quando
  // abre uma conversa nova.
  const isOpen = !['RESOLVED', 'ARCHIVED'].includes(row.status);
  const status = isOpen
    ? decision.level === 'HUMAN_REQUIRED' || result.requires_human
      ? 'WAITING_HUMAN'
      : 'OPEN'
    : row.status;

  await tx.query(
    `UPDATE conversations
        SET priority = $2::message_priority,
            subject  = $3,
            status   = $4::conversation_status
      WHERE id = $1`,
    [conversationId, priority, subject, status],
  );
}

/** Passo 17. Só o que merece interromper alguém. */
async function notify(
  message: MessageRow,
  result: AnalysisResult,
  decision: AutomationDecision,
  tx: Queryable,
): Promise<void> {
  if (result.priority === 'URGENTE') {
    await analysisRepo.insertNotification(
      {
        type: 'URGENT_MESSAGE',
        priority: 'URGENTE',
        title: `Mensagem urgente: ${result.summary.slice(0, 120)}`,
        body: result.urgency_reason,
        conversationId: message.conversation_id,
        messageId: message.id,
        contactId: message.contact_id,
      },
      tx,
    );
    return;
  }

  // Uma notificação por cada rascunho normal encheria o sino de ruído. Só
  // os que exigem mesmo uma decisão humana aparecem.
  if (decision.level === 'HUMAN_REQUIRED') {
    await analysisRepo.insertNotification(
      {
        type: 'APPROVAL_PENDING',
        priority: result.priority,
        title: `Resposta à espera de aprovação: ${result.summary.slice(0, 120)}`,
        body: decision.reason,
        conversationId: message.conversation_id,
        messageId: message.id,
        contactId: message.contact_id,
      },
      tx,
    );
  }
}

export interface BatchResult {
  analyzed: number;
  retried: number;
  failed: number;
  /** Ficaram mensagens por analisar quando o lote acabou? */
  remaining: number;
  outcomes: AnalysisOutcome[];
}

/**
 * Processa até `limit` mensagens da fila.
 *
 * O lote existe por causa do tempo máximo de uma função serverless: mais
 * vale analisar cinco mensagens e responder do que tentar cinquenta e ser
 * interrompido a meio da trigésima. O que sobrar fica na fila para a
 * execução seguinte, e o `remaining` diz a quem chamou se vale a pena
 * voltar já.
 */
export async function runAnalysisBatch(limit?: number): Promise<BatchResult> {
  const env = getEnv();
  const max = limit ?? env.AI_BATCH_SIZE;

  const outcomes: AnalysisOutcome[] = [];
  let analyzed = 0;
  let retried = 0;
  let failed = 0;

  for (let i = 0; i < max; i += 1) {
    const message = await messagesRepo.claimMessageForAnalysis();
    if (!message) break;

    const outcome = await analyzeMessage(message);
    outcomes.push(outcome);

    if (outcome.status === 'analyzed') analyzed += 1;
    else if (outcome.status === 'retry') {
      retried += 1;
      // A falha foi de rede ou de limite de pedidos: as mensagens
      // seguintes iriam bater na mesma parede. Parar agora poupa
      // tentativas e deixa a fila intacta.
      break;
    } else failed += 1;
  }

  const stats = await messagesRepo.getAnalysisQueueStats();

  return { analyzed, retried, failed, remaining: stats.pending, outcomes };
}

/** A análise está ligada e configurada neste ambiente? */
export function isAnalysisAvailable(): boolean {
  return isAiEnabled();
}
