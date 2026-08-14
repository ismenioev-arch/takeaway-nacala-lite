/**
 * Serviço de Análise de Mensagens com Claude.
 *
 * Processa cada mensagem inbound para extrair:
 * - Intent (NOVO_CLIENTE, ORCAMENTO, PROJETO, etc)
 * - Priority (URGENTE, IMPORTANTE, ACOMPANHAR, NORMAL)
 * - Confidence (0-1)
 * - Resumo
 * - Se requer intervenção humana
 * - Ação recomendada
 *
 * Usa prompt caching para reduzir custos em contexto repetitivo.
 */
import Anthropic from '@anthropic-ai/sdk';
import { getEnv } from '../config/env.js';
import type { Intent, Priority } from '../models/enums.js';
import { INTENTS, PRIORITIES } from '../models/enums.js';
import * as messageAnalysisRepo from '../repositories/message-analysis.repository.js';
import * as messagesRepo from '../repositories/messages.repository.js';
import * as conversationsRepo from '../repositories/conversations.repository.js';
import type { Queryable } from '../database/pool.js';

const ANTHROPIC_MODEL = 'claude-opus-5';
const PROMPT_VERSION = '1.0';

interface AnalysisResult {
  intent: Intent;
  priority: Priority;
  confidence: number;
  summary: string;
  urgencyReason?: string;
  requiresHuman: boolean;
  recommendedAction?: string;
}

/**
 * Análise uma mensagem recebida do WhatsApp.
 *
 * Chamado após a mensagem ser armazenada em `messages`.
 * Se a análise falhar, registamos o erro mas não falhamos o processamento.
 */
export async function analyzeInboundMessage(
  messageId: string,
  queryable?: Queryable,
): Promise<void> {
  try {
    const { ANTHROPIC_API_KEY } = getEnv();

    if (!ANTHROPIC_API_KEY) {
      return;
    }

    // Recuperar mensagem
    const message = await messagesRepo.findMessageById(messageId, queryable);
    if (!message) {
      console.error(`Mensagem ${messageId} não encontrada`);
      return;
    }

    // Não analisar se não tem corpo (ex: media-only)
    if (!message.body) {
      return;
    }

    // Recuperar conversa para contexto
    const conversation = await conversationsRepo.findConversationById(
      message.conversation_id,
      queryable,
    );

    // Fazer análise
    const startTime = Date.now();
    const conversationContext =
      conversation && 'latest_summary' in conversation
        ? (conversation.latest_summary as string | null)
        : null;
    const analysis = await analyzeWithClaude(message.body, conversationContext);
    const latencyMs = Date.now() - startTime;

    // Registar análise
    await messageAnalysisRepo.insertMessageAnalysis(
      {
        messageId,
        priority: analysis.priority,
        intent: analysis.intent,
        confidence: analysis.confidence,
        summary: analysis.summary,
        urgencyReason: analysis.urgencyReason,
        requiresHuman: analysis.requiresHuman,
        recommendedAction: analysis.recommendedAction,
        model: ANTHROPIC_MODEL,
        promptVersion: PROMPT_VERSION,
        latencyMs,
        tokensInput: 0, // TODO: extrair do response
        tokensOutput: 0, // TODO: extrair do response
        rawResponse: analysis,
      },
      queryable,
    );

    // Atualizar prioridade da conversa se necessário
    if (analysis.priority !== 'NORMAL') {
      await conversationsRepo.updateConversation(
        message.conversation_id,
        { priority: analysis.priority },
        queryable,
      );
    }
  } catch (error) {
    console.error('Erro ao analisar mensagem:', error);
    // Não re-lançar; a mensagem já foi armazenada
  }
}

/**
 * Chama Claude para análise.
 */
async function analyzeWithClaude(
  messageBody: string,
  conversationContext?: string | null,
): Promise<AnalysisResult> {
  const client = new Anthropic();

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(messageBody, conversationContext);

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 500,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  });

  // Extrair conteúdo
  const content = response.content[0];
  if (!content || content.type !== 'text') {
    throw new Error('Resposta inesperada de Claude');
  }

  // Parse JSON
  const parsed = parseClaudeResponse(content.text);
  return parsed;
}

function buildSystemPrompt(): string {
  const intentsStr = INTENTS.join(', ');
  const prioritiesStr = PRIORITIES.join(', ');

  return `Você é um assistente especializado em análise de mensagens de suporte a clientes.

Para cada mensagem, determine:
1. **intent** - A intenção principal do cliente. Valores válidos: ${intentsStr}
2. **priority** - Urgência da resposta. Valores válidos: ${prioritiesStr}
3. **confidence** - Confiança na análise (0-1, ex: 0.95)
4. **summary** - Resumo conciso (1-2 frases)
5. **urgencyReason** - Por que é urgente (se priority ≠ NORMAL)
6. **requiresHuman** - Se precisa revisão humana antes de responder
7. **recommendedAction** - Que ação tomar (ex: "Enviar orçamento", "Agendar reunião")

Responda SEMPRE em JSON válido neste formato:
{
  "intent": "NOVO_CLIENTE",
  "priority": "IMPORTANTE",
  "confidence": 0.95,
  "summary": "Cliente novo solicitando informações sobre serviços",
  "urgencyReason": "Primeiro contacto, cliente qualificado",
  "requiresHuman": false,
  "recommendedAction": "Enviar catálogo de serviços"
}`;
}

function buildUserPrompt(messageBody: string, conversationContext?: string | null): string {
  let prompt = `Analise esta mensagem do cliente:\n\n"${messageBody}"`;

  if (conversationContext) {
    prompt += `\n\nContexto da conversa:\n${conversationContext}`;
  }

  prompt += '\n\nRetorne JSON válido.';
  return prompt;
}

function parseClaudeResponse(text: string): AnalysisResult {
  // Extrair JSON do response (pode estar entre ```json ... ```)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Não foi possível extrair JSON da resposta');
  }

  const data = JSON.parse(jsonMatch[0]);

  // Validar campos obrigatórios
  if (!data.intent || !data.priority || typeof data.confidence !== 'number') {
    throw new Error('Resposta incompleta de Claude');
  }

  // Validar enum values
  if (!INTENTS.includes(data.intent)) {
    throw new Error(`Intent inválido: ${data.intent}`);
  }
  if (!PRIORITIES.includes(data.priority)) {
    throw new Error(`Priority inválida: ${data.priority}`);
  }

  return {
    intent: data.intent as Intent,
    priority: data.priority as Priority,
    confidence: Math.max(0, Math.min(1, data.confidence)),
    summary: data.summary || 'Sem resumo',
    urgencyReason: data.urgencyReason,
    requiresHuman: Boolean(data.requiresHuman),
    recommendedAction: data.recommendedAction,
  };
}
