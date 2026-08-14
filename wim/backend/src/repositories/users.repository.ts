/**
 * Acesso a `users`.
 *
 * O `password_hash` só sai daqui na função de autenticação. Todas as outras
 * devolvem `SafeUserRow`, que não o inclui — assim é impossível expor o hash
 * por descuido numa resposta da API.
 */
import type { UserRow } from '../models/domain.js';
import type { UserRole } from '../models/enums.js';
import { getPool, type Queryable } from '../database/pool.js';

/** Utilizador sem o hash da password. */
export type SafeUserRow = Omit<UserRow, 'password_hash'> & {
  tokens_valid_from: Date;
};

const SAFE_COLUMNS = `
  id, email, name, role, is_active, last_login_at,
  tokens_valid_from, created_at, updated_at
`;

export async function findUserById(
  id: string,
  db: Queryable = getPool(),
): Promise<SafeUserRow | null> {
  const result = await db.query<SafeUserRow>(
    `SELECT ${SAFE_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** Com o hash — usada apenas pelo login. */
export async function findUserForAuthentication(
  email: string,
  db: Queryable = getPool(),
): Promise<(SafeUserRow & { password_hash: string }) | null> {
  const result = await db.query<SafeUserRow & { password_hash: string }>(
    `SELECT ${SAFE_COLUMNS}, password_hash FROM users WHERE email = $1`,
    [email],
  );
  return result.rows[0] ?? null;
}

export async function listUsers(db: Queryable = getPool()): Promise<SafeUserRow[]> {
  const result = await db.query<SafeUserRow>(
    `SELECT ${SAFE_COLUMNS} FROM users ORDER BY name`,
  );
  return result.rows;
}

export interface CreateUserData {
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
}

export async function insertUser(
  data: CreateUserData,
  db: Queryable = getPool(),
): Promise<SafeUserRow> {
  const result = await db.query<SafeUserRow>(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING ${SAFE_COLUMNS}`,
    [data.email, data.passwordHash, data.name, data.role],
  );
  return result.rows[0]!;
}

export async function recordLogin(id: string, db: Queryable = getPool()): Promise<void> {
  await db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [id]);
}

/**
 * Muda a password e invalida tudo o que foi emitido antes.
 *
 * `tokens_valid_from` avança para agora: qualquer access token já emitido
 * deixa de ser aceite, sem ser preciso mantê-los numa lista negra.
 */
export async function updatePassword(
  id: string,
  passwordHash: string,
  db: Queryable = getPool(),
): Promise<void> {
  await db.query(
    `UPDATE users SET password_hash = $2, tokens_valid_from = now() WHERE id = $1`,
    [id, passwordHash],
  );
}

export async function setUserActive(
  id: string,
  isActive: boolean,
  db: Queryable = getPool(),
): Promise<SafeUserRow | null> {
  const result = await db.query<SafeUserRow>(
    `UPDATE users SET is_active = $2 WHERE id = $1 RETURNING ${SAFE_COLUMNS}`,
    [id, isActive],
  );
  return result.rows[0] ?? null;
}

export async function countUsers(db: Queryable = getPool()): Promise<number> {
  const result = await db.query<{ count: string }>(`SELECT count(*) AS count FROM users`);
  return Number(result.rows[0]?.count ?? 0);
}
