/**
 * Acesso a `refresh_tokens` e `login_attempts`.
 */
import { getPool, type Queryable } from '../database/pool.js';

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
  replaced_by: string | null;
  created_at: Date;
  last_used_at: Date | null;
}

export type RevokeReason = 'logout' | 'rotated' | 'reuse_detected' | 'password_changed';

export interface CreateRefreshTokenData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function insertRefreshToken(
  data: CreateRefreshTokenData,
  db: Queryable = getPool(),
): Promise<RefreshTokenRow> {
  const result = await db.query<RefreshTokenRow>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      data.userId,
      data.tokenHash,
      data.expiresAt,
      data.ipAddress ?? null,
      data.userAgent?.slice(0, 500) ?? null,
    ],
  );
  return result.rows[0]!;
}

/**
 * Procura pelo hash — inclusive tokens já revogados ou expirados.
 *
 * É deliberado: precisamos de distinguir «este token nunca existiu» de «este
 * token existiu e já foi usado», que é o sinal de roubo.
 */
export async function findRefreshTokenByHash(
  tokenHash: string,
  db: Queryable = getPool(),
): Promise<RefreshTokenRow | null> {
  const result = await db.query<RefreshTokenRow>(
    `SELECT * FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

export async function revokeRefreshToken(
  id: string,
  reason: RevokeReason,
  replacedBy: string | null = null,
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens
        SET revoked_at = now(), revoked_reason = $2, replaced_by = $3
      WHERE id = $1 AND revoked_at IS NULL`,
    [id, reason, replacedBy],
  );
}

/** Fecha todas as sessões de um utilizador. Devolve quantas fechou. */
export async function revokeAllUserTokens(
  userId: string,
  reason: RevokeReason,
  db: Queryable = getPool(),
): Promise<number> {
  const result = await db.query(
    `UPDATE refresh_tokens
        SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
  return result.rowCount ?? 0;
}

export async function markRefreshTokenUsed(
  id: string,
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(`UPDATE refresh_tokens SET last_used_at = now() WHERE id = $1`, [id]);
}

export async function countActiveSessions(
  userId: string,
  db: Queryable = getPool(),
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM refresh_tokens
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Apaga tokens expirados há mais de 30 dias. Para uma limpeza periódica. */
export async function purgeExpiredTokens(db: Queryable = getPool()): Promise<number> {
  const result = await db.query(
    `DELETE FROM refresh_tokens WHERE expires_at < now() - interval '30 days'`,
  );
  return result.rowCount ?? 0;
}

// ─── Tentativas de entrada ───────────────────────────────────────────────────

export type LoginFailureReason = 'invalid_credentials' | 'user_inactive' | 'rate_limited';

export interface RecordAttemptData {
  email: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  succeeded: boolean;
  failureReason?: LoginFailureReason | null;
}

export async function recordLoginAttempt(
  data: RecordAttemptData,
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(
    `INSERT INTO login_attempts (email, ip_address, user_agent, succeeded, failure_reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      data.email,
      data.ipAddress ?? null,
      data.userAgent?.slice(0, 500) ?? null,
      data.succeeded,
      data.failureReason ?? null,
    ],
  );
}

/**
 * Falhas recentes para este e-mail ou para este endereço.
 *
 * Contamos pelos dois: só por e-mail, qualquer pessoa podia bloquear a conta
 * do dono do sistema à vontade; só por endereço, quem tem vários endereços
 * contornava o travão.
 */
export async function countRecentFailures(
  email: string,
  ipAddress: string | null,
  windowMinutes: number,
  db: Queryable = getPool(),
): Promise<{ byEmail: number; byIp: number }> {
  const result = await db.query<{ by_email: string; by_ip: string }>(
    `SELECT
       count(*) FILTER (WHERE email = $1)                          AS by_email,
       count(*) FILTER (WHERE $2::inet IS NOT NULL AND ip_address = $2::inet) AS by_ip
     FROM login_attempts
     WHERE NOT succeeded
       AND created_at > now() - make_interval(mins => $3)`,
    [email, ipAddress, windowMinutes],
  );

  return {
    byEmail: Number(result.rows[0]?.by_email ?? 0),
    byIp: Number(result.rows[0]?.by_ip ?? 0),
  };
}

/** Limpa as falhas de um e-mail depois de uma entrada bem sucedida. */
export async function clearFailures(
  email: string,
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(
    `DELETE FROM login_attempts WHERE email = $1 AND NOT succeeded`,
    [email],
  );
}
