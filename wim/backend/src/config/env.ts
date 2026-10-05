/**
 * Leitura e validação das variáveis de ambiente.
 *
 * Regra do projecto (especificação, secções 14 e 25): nenhum segredo vive no
 * código. Tudo vem daqui, e este módulo é a ÚNICA porta de entrada para
 * `process.env` em toda a aplicação.
 *
 * O servidor recusa arrancar se faltar uma variável obrigatória. É melhor
 * falhar no arranque, com uma mensagem clara, do que falhar a meio do dia
 * com um cliente à espera.
 */
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/** Um segredo tem de ter comprimento suficiente para não ser adivinhável. */
const secret = (min = 32) => z.string().min(min, `deve ter pelo menos ${min} caracteres`);

/** Texto obrigatório, com mensagem em português. */
const required = z.string().min(1, 'não pode estar vazia');

const durationString = z
  .string()
  .regex(/^\d+[smhd]$/, 'deve ser um número seguido de s, m, h ou d (ex.: 15m, 30d)');

const baseSchema = z.object({
  // ── Aplicação ────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
  HOST: z.string().default('0.0.0.0'),
  APP_BASE_URL: z.string().url().default('http://localhost:3001'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Definida automaticamente pela Vercel ("1"). Não a escreva à mão: serve
  // apenas para o código saber que está a correr numa função sem estado, onde
  // o processo é congelado assim que a resposta sai.
  VERCEL: z.string().optional(),
  // 'silent' desliga os logs por completo — usado pelos testes.
  LOG_LEVEL: z
    .enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // ── Base de dados (obrigatória sempre — sem ela não há sistema) ──────────
  DATABASE_URL: required,
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // ── Limite de pedidos (secção 25) ───────────────────────────────────────
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: durationString.default('1m'),

  // Limite específico do login, por endereço. Mais apertado do que o global,
  // porque o login é o alvo natural de quem tenta adivinhar passwords.
  //
  // É configurável porque num escritório com um único IP de saída todas as
  // pessoas partilham este contador — um valor demasiado baixo trancaria a
  // equipa inteira à porta. O travão que interessa é o outro: o bloqueio POR
  // CONTA, guardado na base de dados, que nenhum IP partilhado contorna.
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_LIMIT_WINDOW: durationString.default('1m'),

  // ── Autenticação (obrigatória desde a FASE 4) ───────────────────────────
  // Sem estes segredos não é possível emitir nem verificar sessões, por isso
  // são obrigatórios em qualquer ambiente. Gere cada um com:
  //     openssl rand -base64 48
  JWT_ACCESS_SECRET: secret(),
  JWT_REFRESH_SECRET: secret(),
  JWT_ACCESS_TTL: durationString.default('15m'),
  JWT_REFRESH_TTL: durationString.default('30d'),

  // ── WhatsApp Cloud API (usada a partir da FASE 6) ────────────────────────
  // O interruptor que decide se a integração está em uso. Desligado, o
  // sistema sobe sem credenciais da Meta e o webhook responde 503 — útil
  // para pôr o painel no ar antes de ter a conta do WhatsApp Business
  // aprovada. Ligado, as credenciais passam a ser obrigatórias.
  WHATSAPP_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  WHATSAPP_APP_SECRET: secret(16).optional(),
  WHATSAPP_VERIFY_TOKEN: secret(16).optional(),
  WHATSAPP_ACCESS_TOKEN: required.optional(),
  WHATSAPP_PHONE_NUMBER_ID: required.optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: required.optional(),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/, 'deve ter o formato vXX.Y').default('v21.0'),

  // ── IA (usada a partir da FASE 8) ────────────────────────────────────────
  // Mesmo princípio do WHATSAPP_ENABLED: desligada, não há análise
  // automática e não é preciso chave da Anthropic.
  AI_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  ANTHROPIC_API_KEY: required.optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  AI_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),
});

/**
 * Uma integração ligada tem de estar completa.
 *
 * A regra deixou de ser «em produção exige-se tudo» e passou a ser «exige-se
 * o que está ligado». A diferença importa na prática: permite pôr o painel
 * no ar, com utilizadores reais a consultar dados reais, enquanto a conta do
 * WhatsApp Business ainda está em aprovação — sem nunca permitir o caso
 * perigoso, que é ter o webhook aberto sem segredo para validar assinaturas.
 *
 * Fora de produção as credenciais continuam opcionais mesmo com a integração
 * ligada, para que se possa correr o servidor local com metade preenchida.
 */
const whatsappRequired = [
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
] as const;

const aiRequired = ['ANTHROPIC_API_KEY'] as const;

const envSchema = baseSchema.superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production') {
    const missing = [
      ...(value.WHATSAPP_ENABLED ? whatsappRequired : []),
      ...(value.AI_ENABLED ? aiRequired : []),
    ];

    for (const key of missing) {
      if (!value[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'é obrigatória quando NODE_ENV=production',
        });
      }
    }
  }

  // Esta verificação não depende do ambiente: um webhook público sem segredo
  // para validar a assinatura aceitaria eventos forjados por qualquer pessoa.
  if (value.WHATSAPP_ENABLED && !value.WHATSAPP_APP_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['WHATSAPP_APP_SECRET'],
      message:
        'é obrigatória quando WHATSAPP_ENABLED=true — sem ela o webhook não consegue ' +
        'distinguir um evento da Meta de um evento forjado',
    });
  }

  if (value.JWT_ACCESS_SECRET && value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_REFRESH_SECRET'],
      message: 'não pode ser igual a JWT_ACCESS_SECRET',
    });
  }
});

export type Env = z.infer<typeof baseSchema>;

/** Erro de configuração, com a lista legível do que falta. */
export class EnvValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      [
        'Configuração inválida — o servidor não pode arrancar.',
        '',
        ...issues.map((issue) => `  • ${issue}`),
        '',
        'Verifique o ficheiro .env (use .env.example como referência).',
        'Para gerar um segredo:  openssl rand -base64 48',
        'Ou corra:  npm run setup:env'
      ].join('\n'),
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Uma variável vazia significa "não definida".
 *
 * O `.env.example` traz as chaves das fases seguintes sem valor
 * (`ANTHROPIC_API_KEY=`). O dotenv lê isso como `''`, não como ausente — e
 * sem esta limpeza o servidor recusaria arrancar em desenvolvimento por causa
 * de variáveis que ainda não são precisas.
 */
function dropEmpty(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() === '') continue;
    cleaned[key] = value;
  }

  return cleaned;
}

/**
 * Valida um conjunto de variáveis. Exportada para poder ser testada sem
 * depender do `process.env` real.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(dropEmpty(source));

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(desconhecida)';
      return `${key}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }

  return result.data;
}

let cached: Env | undefined;

/** Configuração validada da aplicação. Lê e valida na primeira chamada. */
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

/** Apenas para testes: esquece a configuração em cache. */
export function resetEnvCache(): void {
  cached = undefined;
}

export const isProduction = (env: Env = getEnv()): boolean => env.NODE_ENV === 'production';
export const isTest = (env: Env = getEnv()): boolean => env.NODE_ENV === 'test';

/**
 * Integrações activas. Lidas aqui e não espalhadas por `if (env.X_ENABLED)`
 * pelo código, para que a resposta à pergunta «isto está ligado?» tenha um
 * único sítio onde mudar.
 */
export const isWhatsAppEnabled = (env: Env = getEnv()): boolean => env.WHATSAPP_ENABLED;
export const isAiEnabled = (env: Env = getEnv()): boolean => env.AI_ENABLED;

/**
 * Estamos numa função sem estado (Vercel) em vez de um servidor permanente?
 *
 * Num servidor, trabalho lançado depois de responder continua a correr. Numa
 * função, o processo é congelado assim que a resposta sai e esse trabalho
 * desaparece a meio. Quem precisa de garantir que o trabalho termina tem de
 * perguntar por aqui.
 */
export const isServerless = (env: Env = getEnv()): boolean => Boolean(env.VERCEL);
