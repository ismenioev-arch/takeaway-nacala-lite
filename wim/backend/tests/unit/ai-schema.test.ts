/**
 * Validação do que a IA devolve.
 *
 * A saída estruturada da API molda a resposta, mas não a garante contra
 * tudo: um valor fora de gama, um resumo vazio ou uma urgência sem
 * justificação passam pelo JSON Schema e são recusados aqui. A regra é a
 * do passo 12 da arquitectura — nunca gravar lixo.
 */
import { describe, expect, it } from 'vitest';
import { analysisJsonSchema, analysisResultSchema } from '../../src/services/ai/schema.js';
import { INTENTS, PRIORITIES } from '../../src/models/enums.js';

const valid = {
  priority: 'NORMAL',
  intent: 'INFORMACAO',
  confidence: 0.82,
  summary: 'O cliente quer saber o horário de atendimento.',
  urgency_reason: null,
  requires_human: false,
  recommended_action: 'Confirmar o horário de sábado.',
  suggested_reply: 'Estamos abertos de segunda a sexta, das oito às cinco.',
  mentions_price_or_deadline: false,
  grounded_in_registered_facts: true,
};

describe('analysisResultSchema', () => {
  it('aceita uma análise bem formada', () => {
    const result = analysisResultSchema.safeParse(valid);

    expect(result.success).toBe(true);
  });

  it('preenche os campos opcionais em falta com null', () => {
    const { urgency_reason, recommended_action, ...semOpcionais } = valid;
    void urgency_reason;
    void recommended_action;

    const result = analysisResultSchema.parse(semOpcionais);

    expect(result.urgency_reason).toBeNull();
    expect(result.recommended_action).toBeNull();
  });

  it('recusa uma prioridade inventada', () => {
    const result = analysisResultSchema.safeParse({ ...valid, priority: 'MUITO_URGENTE' });

    expect(result.success).toBe(false);
  });

  it('recusa uma intenção inventada', () => {
    const result = analysisResultSchema.safeParse({ ...valid, intent: 'COMPRAR_CIMENTO' });

    expect(result.success).toBe(false);
  });

  it.each([1.4, -0.1, Number.NaN])('recusa a confiança %s', (confidence) => {
    const result = analysisResultSchema.safeParse({ ...valid, confidence });

    expect(result.success).toBe(false);
  });

  it('recusa um resumo vazio ou só com espaços', () => {
    expect(analysisResultSchema.safeParse({ ...valid, summary: '' }).success).toBe(false);
    expect(analysisResultSchema.safeParse({ ...valid, summary: '   ' }).success).toBe(false);
  });

  it('recusa uma resposta sugerida vazia', () => {
    expect(analysisResultSchema.safeParse({ ...valid, suggested_reply: '' }).success).toBe(false);
  });

  it('recusa URGENTE sem justificação — a mesma regra que a base de dados impõe', () => {
    const semMotivo = analysisResultSchema.safeParse({
      ...valid,
      priority: 'URGENTE',
      urgency_reason: null,
    });
    const comEspacos = analysisResultSchema.safeParse({
      ...valid,
      priority: 'URGENTE',
      urgency_reason: '   ',
    });

    expect(semMotivo.success).toBe(false);
    expect(comEspacos.success).toBe(false);
  });

  it('aceita URGENTE com justificação', () => {
    const result = analysisResultSchema.safeParse({
      ...valid,
      priority: 'URGENTE',
      urgency_reason: 'A obra está parada desde ontem.',
    });

    expect(result.success).toBe(true);
  });

  it('recusa campos obrigatórios em falta', () => {
    for (const field of ['priority', 'intent', 'confidence', 'summary', 'suggested_reply']) {
      const incompleto: Record<string, unknown> = { ...valid };
      delete incompleto[field];

      expect(analysisResultSchema.safeParse(incompleto).success).toBe(false);
    }
  });

  it.each([null, undefined, 'texto solto', 42, []])('recusa %s em vez de um objecto', (input) => {
    expect(analysisResultSchema.safeParse(input).success).toBe(false);
  });
});

describe('analysisJsonSchema — o que é enviado à API', () => {
  it('oferece exactamente os valores do domínio', () => {
    // Se alguém acrescentar uma intenção aos enums e esquecer o schema, o
    // modelo nunca a poderia escolher. Derivam ambos da mesma constante,
    // e este teste garante que continua assim.
    expect(analysisJsonSchema.properties.priority.enum).toEqual([...PRIORITIES]);
    expect(analysisJsonSchema.properties.intent.enum).toEqual([...INTENTS]);
  });

  it('não exige os campos que podem legitimamente ser nulos', () => {
    expect(analysisJsonSchema.required).not.toContain('urgency_reason');
    expect(analysisJsonSchema.required).not.toContain('recommended_action');
  });

  it('exige as duas auto-declarações usadas na decisão de automação', () => {
    expect(analysisJsonSchema.required).toContain('mentions_price_or_deadline');
    expect(analysisJsonSchema.required).toContain('grounded_in_registered_facts');
  });
});
