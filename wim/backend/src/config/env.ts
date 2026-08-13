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

  // ── Autenticação (usada a partir da FASE 4) ─────────────────────────────
  JWT_ACCESS_SECRET: secret().optional(),
  JWT_REFRESH_SECRET: secret().optional(),
  JWT_ACCESS_TTL: durationString.default('15m'),
  JWT_REFRESH_TTL: durationString.default('30d'),

  // ── WhatsApp Cloud API (usada a partir da FASE 6) ────────────────────────
  WHATSAPP_APP_SECRET: secret(16).optional(),
  WHATSAPP_VERIFY_TOKEN: secret(16).optional(),
  WHATSAPP_ACCESS_TOKEN: required.optional(),
  WHATSAPP_PHONE_NUMBER_ID: required.optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: required.optional(),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/, 'deve ter o formato vXX.Y').default('v21.0'),

  // ── IA (usada a partir da FASE 8) ────────────────────────────────────────
  ANTHROPIC_API_KEY: required.optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  AI_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),
});

/**
 * Em produção, o que é opcional em desenvolvimento passa a obrigatório.
 * Assim ninguém coloca o sistema em produção sem o segredo do webhook.
 */
const productionRequired = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'ANTHROPIC_API_KEY',
] as const;

const envSchema = baseSchema.superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return;

  for (const key of productionRequired) {
    if (!value[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'é obrigatória quando NODE_ENV=production',
      });
    }
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
