/**
 * A matriz intenção × prioridade × confiança.
 *
 * A arquitectura chama-lhe «o teste mais importante do sistema», e a razão
 * é uma só: garante que um orçamento nunca pode ser enviado
 * automaticamente. Tudo o resto no WIM é recuperável — uma classificação
 * errada corrige-se, um resumo mau ignora-se. Uma resposta automática com
 * um preço inventado já saiu.
 *
 * Por isso os casos aqui são exaustivos e não exemplares: percorrem todas
 * as intenções, e não uma amostra.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTOMATABLE_INTENTS,
  decideAutomationLevel,
  HUMAN_ONLY_INTENTS,
  mentionsMoneyOrDeadline,
  type AutomationInput,
} from '../../src/services/ai/automation.js';
import { INTENTS, PRIORITIES } from '../../src/models/enums.js';

/**
 * O caso mais favorável possível a uma resposta automática.
 *
 * Cada teste altera uma coisa de cada vez a partir daqui. Assim, quando um
 * caso dá AUTO, sabe-se que foi por causa do que mudou — e quando dá
 * DRAFT, sabe-se exactamente o que o impediu.
 */
function permissiveInput(overrides: Partial<AutomationInput> = {}): AutomationInput {
  return {
    intent: 'INFORMACAO',
    priority: 'NORMAL',
    confidence: 0.97,
    requiresHuman: false,
    suggestedReply: 'Estamos abertos de segunda a sexta, das oito às cinco.',
    modelSaysMentionsPriceOrDeadline: false,
    modelSaysGrounded: true,
    globalAutomationEnabled: true,
    confidenceThreshold: 0.9,
    hasRegisteredFacts: true,
    ...overrides,
  };
}

describe('decideAutomationLevel — o que nunca sai sozinho', () => {
  it.each(HUMAN_ONLY_INTENTS)(
    'exige uma pessoa para %s, mesmo no cenário mais favorável',
    (intent) => {
      const decision = decideAutomationLevel(permissiveInput({ intent }));

      expect(decision.level).toBe('HUMAN_REQUIRED');
    },
  );

  it('exige uma pessoa para um orçamento com confiança máxima', () => {
    // O caso que a arquitectura nomeia explicitamente. Confiança 1.0,
    // automação ligada, factos registados: continua a ter de esperar.
    const decision = decideAutomationLevel(
      permissiveInput({ intent: 'ORCAMENTO', confidence: 1 }),
    );

    expect(decision.level).toBe('HUMAN_REQUIRED');
    expect(decision.reason).toContain('ORCAMENTO');
  });

  it('exige uma pessoa para tudo o que for urgente', () => {
    for (const intent of INTENTS) {
      const decision = decideAutomationLevel(permissiveInput({ intent, priority: 'URGENTE' }));

      expect(decision.level).toBe('HUMAN_REQUIRED');
    }
  });

  it('exige uma pessoa quando a própria análise o pediu', () => {
    const decision = decideAutomationLevel(permissiveInput({ requiresHuman: true }));

    expect(decision.level).toBe('HUMAN_REQUIRED');
  });

  it('exige uma pessoa quando o modelo admite ter falado de preços', () => {
    const decision = decideAutomationLevel(
      permissiveInput({ modelSaysMentionsPriceOrDeadline: true }),
    );

    expect(decision.level).toBe('HUMAN_REQUIRED');
  });

  it('exige uma pessoa quando o texto fala de dinheiro apesar de o modelo dizer que não', () => {
    // O caso perigoso: o modelo declara-se inocente e escreve um valor na
    // mesma. A verificação do texto é a que manda.
    const decision = decideAutomationLevel(
      permissiveInput({
        suggestedReply: 'Esse serviço fica por 7500 MT, pode passar amanhã.',
        modelSaysMentionsPriceOrDeadline: false,
      }),
    );

    expect(decision.level).toBe('HUMAN_REQUIRED');
  });
});

describe('decideAutomationLevel — o que fica como rascunho', () => {
  const neitherAutoNorHuman = INTENTS.filter(
    (intent) =>
      !HUMAN_ONLY_INTENTS.includes(intent) && !AUTOMATABLE_INTENTS.includes(intent),
  );

  it.each(neitherAutoNorHuman)('deixa %s como rascunho', (intent) => {
    const decision = decideAutomationLevel(permissiveInput({ intent }));

    expect(decision.level).toBe('DRAFT');
  });

  it('deixa como rascunho quando a automação global está desligada', () => {
    const decision = decideAutomationLevel(permissiveInput({ globalAutomationEnabled: false }));

    expect(decision.level).toBe('DRAFT');
    expect(decision.reason).toContain('desligada');
  });

  it('deixa como rascunho logo abaixo do limiar, e automatiza exactamente no limiar', () => {
    const abaixo = decideAutomationLevel(
      permissiveInput({ confidence: 0.899, confidenceThreshold: 0.9 }),
    );
    const igual = decideAutomationLevel(
      permissiveInput({ confidence: 0.9, confidenceThreshold: 0.9 }),
    );

    expect(abaixo.level).toBe('DRAFT');
    expect(igual.level).toBe('AUTO');
  });

  it('respeita um limiar mais exigente definido pelo dono do negócio', () => {
    const decision = decideAutomationLevel(
      permissiveInput({ confidence: 0.95, confidenceThreshold: 0.99 }),
    );

    expect(decision.level).toBe('DRAFT');
  });

  it('deixa como rascunho quando o modelo admite ter saído do contexto', () => {
    const decision = decideAutomationLevel(permissiveInput({ modelSaysGrounded: false }));

    expect(decision.level).toBe('DRAFT');
  });

  it('deixa como rascunho quando não há factos registados onde assentar', () => {
    // Sistema acabado de instalar, sem FAQs nem serviços. Nada para
    // repetir com segurança.
    const decision = decideAutomationLevel(permissiveInput({ hasRegisteredFacts: false }));

    expect(decision.level).toBe('DRAFT');
  });
});

describe('decideAutomationLevel — o que pode sair sozinho', () => {
  it.each(AUTOMATABLE_INTENTS)('automatiza %s quando tudo está em ordem', (intent) => {
    const decision = decideAutomationLevel(permissiveInput({ intent }));

    expect(decision.level).toBe('AUTO');
  });

  it('nunca automatiza nada se a intenção não for INFORMACAO ou SUPORTE', () => {
    const automated = INTENTS.filter(
      (intent) => decideAutomationLevel(permissiveInput({ intent })).level === 'AUTO',
    );

    expect(automated.sort()).toEqual([...AUTOMATABLE_INTENTS].sort());
  });

  it('explica sempre a decisão por escrito', () => {
    for (const intent of INTENTS) {
      for (const priority of PRIORITIES) {
        const decision = decideAutomationLevel(permissiveInput({ intent, priority }));

        expect(decision.reason.length).toBeGreaterThan(10);
      }
    }
  });
});

describe('mentionsMoneyOrDeadline', () => {
  it.each([
    'Fica por 7500 MT.',
    'São 7.500,00 MZN mais IVA.',
    'O preço é esse mesmo.',
    'Posso fazer um desconto de 10%.',
    'Quanto custa depende do tamanho.',
    'Entregamos em 5 dias.',
    'O prazo é apertado.',
    'Fica pronto até sexta.',
    'Esse serviço é grátis.',
    'Pode pagar na entrega.',
  ])('apanha «%s»', (text) => {
    expect(mentionsMoneyOrDeadline(text)).toBe(true);
  });

  it.each([
    'Estamos abertos de segunda a sexta, das oito às cinco.',
    'Sim, fazemos esse tipo de trabalho.',
    'O nosso escritório fica na Baixa de Nacala.',
    'Obrigado pela mensagem, vamos ver isso.',
  ])('deixa passar «%s»', (text) => {
    expect(mentionsMoneyOrDeadline(text)).toBe(false);
  });
});
