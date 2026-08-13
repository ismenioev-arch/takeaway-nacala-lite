/**
 * Validadores partilhados.
 *
 * Nada entra na aplicação sem passar por aqui (especificação, secção 25).
 * Um `ZodError` lançado por qualquer destes schemas é apanhado pelo tratador
 * central de erros e devolvido como 400 com a lista de campos inválidos.
 */
import { z } from 'zod';

/** Identificador de recurso. */
export const uuidSchema = z.string().uuid('deve ser um identificador válido');

export const idParamSchema = z.object({ id: uuidSchema });
export type IdParam = z.infer<typeof idParamSchema>;

/**
 * Paginação.
 *
 * O limite máximo existe para que um pedido não consiga arrastar a base de
 * dados inteira numa resposta.
 */
export const MAX_PAGE_SIZE = 100;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const sortDirectionSchema = z.enum(['asc', 'desc']).default('desc');

/** Sem valor por omissão — para quem quer decidir o sentido conforme o campo. */
export const sortDirectionOptionalSchema = z.enum(['asc', 'desc']);

/**
 * Uma lista que também aceita um único valor.
 *
 * `?status=OPEN` e `?status=OPEN&status=NEW` chegam a Fastify como string e
 * como array. Isto normaliza os dois casos, para o controlador não ter de
 * saber a diferença.
 */
export function multiValue<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
    z.array(schema).optional(),
  );
}

/** Texto de pesquisa: recortado, e recusado se ficar demasiado curto. */
export const searchTermSchema = z
  .string()
  .trim()
  .min(2, 'a pesquisa precisa de pelo menos 2 caracteres')
  .max(200, 'a pesquisa é demasiado longa');

/** Data em ISO 8601 (`2026-08-13` ou `2026-08-13T10:00:00Z`). */
export const isoDateSchema = z.coerce.date({
  errorMap: () => ({ message: 'deve ser uma data válida em formato ISO 8601' }),
});

/**
 * Intervalo de datas, com validação de coerência.
 * Um intervalo invertido é quase sempre um erro de quem chama, não uma
 * pesquisa legítima que devolve zero resultados.
 */
export const dateRangeSchema = z
  .object({
    dateFrom: isoDateSchema.optional(),
    dateTo: isoDateSchema.optional(),
  })
  .refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
    message: 'dateFrom tem de ser anterior ou igual a dateTo',
    path: ['dateFrom'],
  });

/** Booleano vindo da query string (`?unanswered=true`). */
export const queryBooleanSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

/** Texto opcional: espaços à volta são removidos, e o vazio vira `null`. */
export const optionalText = (max: number) =>
  z
    .string()
    .max(max, `não pode ter mais de ${max} caracteres`)
    .transform((value) => value.trim())
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

/** Texto obrigatório e não vazio. */
export const requiredText = (max: number, label = 'campo') =>
  z
    .string()
    .trim()
    .min(1, `${label} não pode estar vazio`)
    .max(max, `não pode ter mais de ${max} caracteres`);

/**
 * Telefone em formato E.164 — a mesma regra que a constraint da base de dados.
 * Validar aqui devolve uma mensagem útil em vez de um erro de PostgreSQL.
 */
export const phoneE164Schema = z
  .string()
  .trim()
  .regex(
    /^\+[1-9][0-9]{7,14}$/,
    'deve estar em formato internacional, por exemplo +258840001234',
  );
