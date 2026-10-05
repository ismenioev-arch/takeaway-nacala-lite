/**
 * O contrato com o modelo.
 *
 * A Claude é chamada com *structured output*: o formato da resposta é
 * declarado à API, que garante JSON válido e conforme. Não é «pede JSON e
 * reza» — mas também não chega. Um JSON bem formado pode trazer uma
 * prioridade inventada, uma confiança de 1.4 ou um resumo vazio, e nada
 * disso pode entrar na base de dados.
 *
 * Por isso há dois níveis:
 *   1. o JSON Schema, enviado à API, que molda a resposta;
 *   2. o esquema Zod, aqui, que a verifica outra vez quando chega.
 *
 * Os valores permitidos derivam de `models/enums.ts`, a mesma fonte que o
 * PostgreSQL usa. Acrescentar uma intenção nova é uma alteração num sítio só.
 */
import { z } from 'zod';
import { INTENTS, PRIORITIES } from '../../models/enums.js';

/**
 * Versão do prompt, gravada com cada análise.
 *
 * Sem isto é impossível responder, meses depois, à pergunta «porque é que
 * esta mensagem foi classificada assim?». Mudar o prompt sem mudar esta
 * string é perder essa resposta.
 */
export const PROMPT_VERSION = '2026-10-05.1';

export const analysisResultSchema = z
  .object({
    priority: z.enum(PRIORITIES),
    intent: z.enum(INTENTS),

    /** Quão segura a IA está da sua própria classificação. */
    confidence: z.number().min(0).max(1),

    /** Uma frase. É o que o painel mostra na listagem. */
    summary: z.string().trim().min(1).max(500),

    /** Obrigatório quando a prioridade é URGENTE — ver o refine abaixo. */
    urgency_reason: z.string().trim().max(500).nullable().default(null),

    /** A IA acha que isto precisa mesmo de uma pessoa? */
    requires_human: z.boolean(),

    recommended_action: z.string().trim().max(500).nullable().default(null),

    /** A resposta sugerida ao cliente. Nunca é enviada sem decisão nossa. */
    suggested_reply: z.string().trim().min(1).max(2000),

    /**
     * Auto-declarações do modelo, usadas na decisão do nível de automação.
     *
     * Não confiamos nelas sozinhas — o código verifica o mesmo por outros
     * meios. Mas quando o modelo admite que inventou, ou que falou de
     * dinheiro, essa admissão só pode tornar a decisão mais conservadora,
     * nunca menos.
     */
    mentions_price_or_deadline: z.boolean(),
    grounded_in_registered_facts: z.boolean(),
  })
  .superRefine((value, ctx) => {
    // A mesma regra existe como CHECK na base de dados. Aqui falha mais
    // cedo e com uma mensagem que diz o que fazer.
    if (value.priority === 'URGENTE' && (value.urgency_reason ?? '').trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['urgency_reason'],
        message: 'é obrigatório quando a prioridade é URGENTE',
      });
    }
  });

export type AnalysisResult = z.infer<typeof analysisResultSchema>;

/**
 * O mesmo contrato, na forma que a API da Anthropic entende.
 *
 * Escrito à mão e não gerado a partir do Zod: são vinte linhas, e uma
 * dependência a mais para as gerar custaria mais do que mantê-las.
 */
export const ANALYSIS_TOOL_NAME = 'registar_analise';

export const analysisJsonSchema = {
  type: 'object',
  properties: {
    priority: {
      type: 'string',
      enum: [...PRIORITIES],
      description: 'Gravidade da mensagem para o negócio.',
    },
    intent: {
      type: 'string',
      enum: [...INTENTS],
      description: 'O que o cliente quer, em uma palavra.',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Quão seguro está desta classificação. Seja honesto: 0.5 se tiver dúvidas.',
    },
    summary: {
      type: 'string',
      description: 'Uma frase curta, em português de Moçambique, a dizer o que o cliente quer.',
    },
    urgency_reason: {
      type: ['string', 'null'],
      description: 'Porque é urgente. Obrigatório se priority for URGENTE, caso contrário null.',
    },
    requires_human: {
      type: 'boolean',
      description: 'True se responder a isto exigir julgamento, decisão comercial ou dados que não tem.',
    },
    recommended_action: {
      type: ['string', 'null'],
      description: 'O que a pessoa que atende deve fazer a seguir.',
    },
    suggested_reply: {
      type: 'string',
      description: 'A resposta a enviar ao cliente, pronta a ler. Português de Moçambique, tratamento por «você».',
    },
    mentions_price_or_deadline: {
      type: 'boolean',
      description: 'True se a sua resposta sugerida referir preços, valores, descontos ou prazos.',
    },
    grounded_in_registered_facts: {
      type: 'boolean',
      description:
        'True apenas se tudo o que escreveu na resposta vier do contexto fornecido. False se teve de assumir seja o que for.',
    },
  },
  required: [
    'priority',
    'intent',
    'confidence',
    'summary',
    'requires_human',
    'suggested_reply',
    'mentions_price_or_deadline',
    'grounded_in_registered_facts',
  ],
} as const;
