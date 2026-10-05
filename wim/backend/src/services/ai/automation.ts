/**
 * Quem decide se uma resposta pode sair sozinha.
 *
 * Decide o código. Não a IA. Esta é a regra de segurança central do sistema
 * (arquitectura, secção 6.3 passo 15) e a razão é simples: pedir ao modelo
 * que avalie se é seguro confiar nele é pedir-lhe que se autoavalie no
 * exacto momento em que está errado.
 *
 * O modelo contribui com factos — intenção, prioridade, confiança, e duas
 * admissões sobre a própria resposta. O que se faz com esses factos está
 * escrito aqui, em código determinístico, testável, e que não muda de
 * opinião entre duas chamadas.
 *
 * Toda a função é pura: entra um objecto, sai uma decisão. Sem base de
 * dados, sem rede, sem relógio.
 */
import type { AutomationLevel, Intent, Priority } from '../../models/enums.js';

/**
 * Intenções que uma máquina nunca responde sozinha.
 *
 * Não é uma lista de coisas difíceis — é uma lista de coisas caras. Um
 * orçamento errado é dinheiro perdido; uma reclamação mal respondida é um
 * cliente perdido; uma cobrança automática mal calibrada é uma relação
 * perdida. Em todas elas o custo de errar é maior do que o incómodo de
 * esperar por uma pessoa.
 */
export const HUMAN_ONLY_INTENTS: readonly Intent[] = [
  'ORCAMENTO',
  'PAGAMENTO',
  'COBRANCA',
  'RECLAMACAO',
  'NEGOCIACAO',
  'ALTERACAO_PROJETO',
];

/**
 * As únicas intenções candidatas a resposta automática.
 *
 * Perguntas cuja resposta já está escrita algures: horários, moradas,
 * «vocês fazem isto?». Repetir o que está registado é a única coisa que
 * uma máquina faz melhor do que uma pessoa ocupada.
 */
export const AUTOMATABLE_INTENTS: readonly Intent[] = ['INFORMACAO', 'SUPORTE'];

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.9;

/**
 * Palavras que transformam uma resposta informativa num compromisso.
 *
 * Usada como segunda opinião sobre a auto-declaração do modelo: se ele diz
 * que não falou de dinheiro mas escreveu «5000 MT», acreditamos no texto.
 * Falsos positivos aqui são baratos — significam apenas que uma pessoa lê
 * a mensagem antes de sair.
 */
const MONEY_OR_DEADLINE_PATTERNS: readonly RegExp[] = [
  /\b\d[\d\s.,]*\s?(mt|mzn|meticais?|usd|rand|eur|dólares?|dolares?)\b/iu,
  /\b(mt|mzn|usd|eur|r\$|\$)\s?\d/iu,
  /\bpre[çc]os?\b/iu,
  /\bcust[ao]m?\b|\bcustar[áa]?\b|\bcustos?\b/iu,
  /\bor[çc]amentos?\b/iu,
  /\bdescontos?\b/iu,
  /\bpagamentos?\b|\bpagar\b/iu,
  /\bfactura|\bfatura/iu,
  /\bprazos?\b/iu,
  /\bentregar?e?i?\b.{0,20}\b(dias?|semanas?|meses?|horas?)\b/iu,
  /\bem\s+\d+\s*(dias?|semanas?|meses?|horas?)\b/iu,
  /\bat[ée]\s+(amanh[ãa]|sexta|segunda|ter[çc]a|quarta|quinta|s[áa]bado|domingo|dia\s+\d+)\b/iu,
  /\bgr[áa]tis\b|\bgratuito\b|\bsem custo\b/iu,
];

/** Verdadeiro se o texto compromete a empresa com um valor ou uma data. */
export function mentionsMoneyOrDeadline(text: string): boolean {
  return MONEY_OR_DEADLINE_PATTERNS.some((pattern) => pattern.test(text));
}

export interface AutomationInput {
  intent: Intent;
  priority: Priority;
  confidence: number;
  requiresHuman: boolean;
  /** A resposta que a IA sugere enviar. É sobre ela que se decide. */
  suggestedReply: string;
  /** O modelo admitiu ter falado de preços ou prazos. */
  modelSaysMentionsPriceOrDeadline: boolean;
  /** O modelo afirma que tudo o que escreveu veio do contexto fornecido. */
  modelSaysGrounded: boolean;
  /** O interruptor geral (`company_profile.auto_reply_enabled`). */
  globalAutomationEnabled: boolean;
  /** `settings['ai.confidence_threshold']`. */
  confidenceThreshold: number;
  /**
   * Havia de facto FAQs, serviços ou horários no contexto?
   *
   * Um modelo pode declarar-se «fundamentado» num contexto vazio sem
   * mentir conscientemente. Se não lhe demos factos, não há nada em que
   * fundamentar, e a resposta não pode ser automática.
   */
  hasRegisteredFacts: boolean;
}

export interface AutomationDecision {
  level: AutomationLevel;
  /**
   * Porquê, em português, para o painel e para o registo de auditoria.
   *
   * Uma decisão de segurança que não se consegue explicar ao dono do
   * negócio é uma decisão que ele não vai confiar.
   */
  reason: string;
}

/**
 * A matriz intenção × confiança. O teste mais importante do sistema.
 *
 * A ordem das regras importa: a primeira que se aplica ganha, e as
 * restritivas vêm todas antes da permissiva. Não há caminho para AUTO que
 * não passe por todas as recusas.
 */
export function decideAutomationLevel(input: AutomationInput): AutomationDecision {
  if (HUMAN_ONLY_INTENTS.includes(input.intent)) {
    return {
      level: 'HUMAN_REQUIRED',
      reason: `Intenção ${input.intent}: envolve dinheiro, compromisso ou conflito. Decide sempre uma pessoa.`,
    };
  }

  if (input.priority === 'URGENTE') {
    return {
      level: 'HUMAN_REQUIRED',
      reason: 'Mensagem urgente: uma pessoa tem de ver isto antes de sair qualquer resposta.',
    };
  }

  if (input.requiresHuman) {
    return {
      level: 'HUMAN_REQUIRED',
      reason: 'A própria análise concluiu que é preciso julgamento humano.',
    };
  }

  // Duas fontes para a mesma pergunta: o que o modelo admite e o que o
  // texto mostra. Basta uma delas.
  if (input.modelSaysMentionsPriceOrDeadline || mentionsMoneyOrDeadline(input.suggestedReply)) {
    return {
      level: 'HUMAN_REQUIRED',
      reason: 'A resposta sugerida menciona preço, valor, desconto ou prazo.',
    };
  }

  if (!AUTOMATABLE_INTENTS.includes(input.intent)) {
    return {
      level: 'DRAFT',
      reason: `Intenção ${input.intent} não está na lista de respostas automáticas. Fica como rascunho.`,
    };
  }

  if (!input.globalAutomationEnabled) {
    return {
      level: 'DRAFT',
      reason: 'A resposta automática está desligada nas definições da empresa.',
    };
  }

  if (input.confidence < input.confidenceThreshold) {
    return {
      level: 'DRAFT',
      reason: `Confiança ${input.confidence.toFixed(2)} abaixo do limiar ${input.confidenceThreshold.toFixed(2)}.`,
    };
  }

  if (!input.modelSaysGrounded || !input.hasRegisteredFacts) {
    return {
      level: 'DRAFT',
      reason: 'A resposta não assenta inteiramente em FAQs, serviços ou horários registados.',
    };
  }

  return {
    level: 'AUTO',
    reason: `Pergunta de ${input.intent.toLowerCase()} respondida com factos registados e confiança ${input.confidence.toFixed(2)}.`,
  };
}
