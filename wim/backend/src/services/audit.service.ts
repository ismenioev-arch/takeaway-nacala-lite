/**
 * Registo de auditoria (especificação, secção 24).
 *
 * Guarda quem fez o quê, quando, sobre que entidade, e com que valores antes
 * e depois. A tabela é imutável — um gatilho recusa UPDATE e DELETE.
 *
 * Nota sobre o autor: até à FASE 4 não existe autenticação, por isso `actor`
 * chega vazio e a acção fica registada como sendo do sistema (`user_id` a
 * NULL). Quando a autenticação existir, basta os controladores passarem o
 * utilizador autenticado — a assinatura já o prevê.
 */
import { getPool, type Queryable } from '../database/pool.js';

/** Acções registadas. Lista fechada para os relatórios serem agrupáveis. */
export const AUDIT_ACTIONS = {
  contactCreated: 'contact.created',
  contactUpdated: 'contact.updated',
  contactDeleted: 'contact.deleted',
  conversationUpdated: 'conversation.updated',
  conversationResolved: 'conversation.resolved',
  conversationReopened: 'conversation.reopened',

  // Autenticação (secção 25). Ficam no mesmo registo de propósito: um
  // relatório de auditoria tem de poder cruzar "quem entrou" com "quem
  // aprovou o quê" sem juntar duas listas diferentes.
  login: 'auth.login',
  loginFailed: 'auth.login_failed',
  logout: 'auth.logout',
  tokenRefreshed: 'auth.token_refreshed',
  refreshReuseDetected: 'auth.refresh_reuse_detected',
  passwordChanged: 'auth.password_changed',
  userCreated: 'auth.user_created',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Quem executou a acção, e de onde. */
export interface Actor {
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  actor?: Actor | undefined;
}

/**
 * Um endereço só é guardado se for válido: a coluna é `inet` e um valor
 * inválido faria falhar a operação que estamos a auditar.
 */
function sanitizeIp(value: string | null | undefined): string | null {
  if (!value) return null;

  // Fastify pode devolver "cliente, proxy1, proxy2" em X-Forwarded-For.
  const first = value.split(',')[0]?.trim() ?? '';
  if (first === '') return null;

  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(first);
  const isIpv6 = /^[0-9a-fA-F:]+$/.test(first) && first.includes(':');

  return isIpv4 || isIpv6 ? first : null;
}

export async function recordAudit(entry: AuditEntry, db: Queryable = getPool()): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs
       (user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
    [
      entry.actor?.userId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.oldValue === undefined ? null : JSON.stringify(entry.oldValue),
      entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
      sanitizeIp(entry.actor?.ipAddress),
      entry.actor?.userAgent?.slice(0, 500) ?? null,
    ],
  );
}

/**
 * Reduz uma linha aos campos que mudaram.
 *
 * Guardar a linha inteira em cada alteração tornaria o histórico ilegível e
 * encheria a tabela; o que interessa é o antes e o depois do que mudou.
 */
export function diffValues<T extends object>(
  before: T,
  after: T,
  fields: readonly (keyof T)[],
): { oldValue: Partial<T>; newValue: Partial<T>; changed: boolean } {
  const oldValue: Partial<T> = {};
  const newValue: Partial<T> = {};
  let changed = false;

  for (const field of fields) {
    if (before[field] === after[field]) continue;

    oldValue[field] = before[field];
    newValue[field] = after[field];
    changed = true;
  }

  return { oldValue, newValue, changed };
}
