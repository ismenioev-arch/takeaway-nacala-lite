/**
 * Configuração que o dono do negócio pode mudar sem um deploy.
 *
 * A distinção face às variáveis de ambiente é clara: segredos e topologia
 * vivem no ambiente; decisões de negócio — a partir de que confiança se
 * confia numa resposta — vivem aqui, onde amanhã há um ecrã para as
 * alterar.
 *
 * Toda a leitura tem valor de recurso. Uma definição em falta, apagada ou
 * com lixo lá dentro não pode parar a análise de mensagens; resulta no
 * comportamento mais conservador que conhecemos.
 */
import { getPool, type Queryable } from '../database/pool.js';
import { logger } from '../config/logger.js';

export async function findSetting(
  key: string,
  db: Queryable = getPool(),
): Promise<unknown | undefined> {
  const result = await db.query<{ value: unknown }>(
    `SELECT value FROM settings WHERE key = $1`,
    [key],
  );

  return result.rows[0]?.value;
}

export async function getNumberSetting(
  key: string,
  fallback: number,
  db: Queryable = getPool(),
): Promise<number> {
  const raw = await findSetting(key, db);
  const value = typeof raw === 'string' ? Number(raw) : raw;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    if (raw !== undefined) {
      logger.warn({ key, raw }, 'Definição não é um número; a usar o valor por omissão');
    }
    return fallback;
  }

  return value;
}

export async function getBooleanSetting(
  key: string,
  fallback: boolean,
  db: Queryable = getPool(),
): Promise<boolean> {
  const raw = await findSetting(key, db);

  if (typeof raw !== 'boolean') {
    if (raw !== undefined) {
      logger.warn({ key, raw }, 'Definição não é um booleano; a usar o valor por omissão');
    }
    return fallback;
  }

  return raw;
}
