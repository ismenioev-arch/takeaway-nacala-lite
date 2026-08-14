/**
 * Autenticação (especificação, secção 25).
 *
 * Decisões de segurança tomadas aqui, e porquê:
 *
 * • **Uma só mensagem de erro para credenciais erradas.** Dizer «este e-mail
 *   não existe» entregaria a lista de utilizadores a quem tentasse adivinhar.
 *
 * • **Verificação contra um hash falso quando o utilizador não existe.** Sem
 *   isso, um e-mail inexistente responderia mais depressa e essa diferença de
 *   tempo revelaria que contas são reais.
 *
 * • **Rotação do refresh token.** Cada renovação gasta o token antigo e emite
 *   um novo. Um token roubado deixa de servir assim que o dono legítimo
 *   renovar.
 *
 * • **Reutilização = roubo.** Se um token já substituído voltar a aparecer,
 *   ou o atacante ou o dono está a usar uma cópia. Fechamos todas as sessões
 *   desse utilizador e obrigamos a entrar de novo.
 */
import { AppError } from '../middleware/errors.js';
import type { UserRole } from '../models/enums.js';
import * as usersRepo from '../repositories/users.repository.js';
import * as sessionsRepo from '../repositories/sessions.repository.js';
import type { SafeUserRow } from '../repositories/users.repository.js';
import {
  DUMMY_HASH,
  hashPassword,
  verifyPassword,
} from '../auth/password.js';
import {
  durationToSeconds,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from '../auth/tokens.js';
import { getEnv } from '../config/env.js';
import { AUDIT_ACTIONS, recordAudit, type Actor } from './audit.service.js';

/** Travão de força bruta: 8 falhas no mesmo e-mail em 15 minutos. */
export const MAX_FAILURES_PER_EMAIL = 8;
/** E 25 falhas do mesmo endereço, que pode estar a atacar várias contas. */
export const MAX_FAILURES_PER_IP = 25;
export const FAILURE_WINDOW_MINUTES = 15;

/** Atalho para as acções de autenticação do registo partilhado. */
export const AUTH_ACTIONS = {
  login: AUDIT_ACTIONS.login,
  loginFailed: AUDIT_ACTIONS.loginFailed,
  logout: AUDIT_ACTIONS.logout,
  refresh: AUDIT_ACTIONS.tokenRefreshed,
  reuseDetected: AUDIT_ACTIONS.refreshReuseDetected,
  passwordChanged: AUDIT_ACTIONS.passwordChanged,
  userCreated: AUDIT_ACTIONS.userCreated,
} as const;

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface LoginResult {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
  /** Segundos até o access token expirar. */
  expiresIn: number;
}

function toAuthenticatedUser(row: SafeUserRow): AuthenticatedUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/** Mensagem única, para não revelar se o problema foi o e-mail ou a password. */
const INVALID_CREDENTIALS = 'E-mail ou password incorrectos.';

async function issueSession(
  user: SafeUserRow,
  actor: Actor | undefined,
): Promise<LoginResult> {
  const env = getEnv();

  const accessToken = await signAccessToken(user.id, user.role);
  const { token: refreshToken, hash } = generateRefreshToken();

  const expiresAt = new Date(Date.now() + durationToSeconds(env.JWT_REFRESH_TTL) * 1000);

  await sessionsRepo.insertRefreshToken({
    userId: user.id,
    tokenHash: hash,
    expiresAt,
    ipAddress: actor?.ipAddress ?? null,
    userAgent: actor?.userAgent ?? null,
  });

  return {
    user: toAuthenticatedUser(user),
    accessToken,
    refreshToken,
    expiresIn: durationToSeconds(env.JWT_ACCESS_TTL),
  };
}

export async function login(
  email: string,
  password: string,
  actor?: Actor,
): Promise<LoginResult> {
  const ipAddress = actor?.ipAddress ?? null;

  // 1. Travão de força bruta, antes de tocar na password.
  const failures = await sessionsRepo.countRecentFailures(
    email,
    ipAddress,
    FAILURE_WINDOW_MINUTES,
  );

  if (failures.byEmail >= MAX_FAILURES_PER_EMAIL || failures.byIp >= MAX_FAILURES_PER_IP) {
    await sessionsRepo.recordLoginAttempt({
      email,
      ipAddress,
      userAgent: actor?.userAgent,
      succeeded: false,
      failureReason: 'rate_limited',
    });

    throw new AppError(
      429,
      'TOO_MANY_ATTEMPTS',
      `Demasiadas tentativas falhadas. Tente de novo dentro de ${FAILURE_WINDOW_MINUTES} minutos.`,
    );
  }

  const user = await usersRepo.findUserForAuthentication(email);

  // 2. Verificar sempre contra alguma coisa, mesmo sem utilizador, para o
  //    tempo de resposta não denunciar que contas existem.
  const passwordMatches = await verifyPassword(user?.password_hash ?? DUMMY_HASH, password);

  if (!user || !passwordMatches) {
    await sessionsRepo.recordLoginAttempt({
      email,
      ipAddress,
      userAgent: actor?.userAgent,
      succeeded: false,
      failureReason: 'invalid_credentials',
    });

    await recordAudit({
      action: AUTH_ACTIONS.loginFailed,
      entityType: 'users',
      entityId: user?.id ?? null,
      newValue: { email },
      actor,
    });

    throw AppError.unauthorized(INVALID_CREDENTIALS);
  }

  // 3. Conta desactivada: a password está certa, mas não pode entrar.
  if (!user.is_active) {
    await sessionsRepo.recordLoginAttempt({
      email,
      ipAddress,
      userAgent: actor?.userAgent,
      succeeded: false,
      failureReason: 'user_inactive',
    });

    throw AppError.forbidden('Esta conta está desactivada. Contacte o administrador.');
  }

  await sessionsRepo.recordLoginAttempt({
    email,
    ipAddress,
    userAgent: actor?.userAgent,
    succeeded: true,
  });
  await sessionsRepo.clearFailures(email);
  await usersRepo.recordLogin(user.id);

  await recordAudit({
    action: AUTH_ACTIONS.login,
    entityType: 'users',
    entityId: user.id,
    actor: { ...actor, userId: user.id },
  });

  return issueSession(user, actor);
}

export async function refresh(refreshToken: string, actor?: Actor): Promise<LoginResult> {
  const hash = hashRefreshToken(refreshToken);
  const stored = await sessionsRepo.findRefreshTokenByHash(hash);

  if (!stored) {
    throw AppError.unauthorized('Sessão inválida. Entre de novo.');
  }

  // Reutilização de um token já gasto: ou é um atacante com uma cópia, ou o
  // utilizador legítimo depois de o token ter sido roubado. Em qualquer dos
  // casos, fechar tudo é a resposta segura.
  if (stored.revoked_at) {
    const closed = await sessionsRepo.revokeAllUserTokens(stored.user_id, 'reuse_detected');

    await recordAudit({
      action: AUTH_ACTIONS.reuseDetected,
      entityType: 'refresh_tokens',
      entityId: stored.id,
      newValue: { sessionsClosed: closed, previousReason: stored.revoked_reason },
      actor: { ...actor, userId: stored.user_id },
    });

    throw AppError.unauthorized(
      'Esta sessão já tinha sido terminada. Por segurança, todas as sessões foram fechadas.',
    );
  }

  if (stored.expires_at <= new Date()) {
    throw AppError.unauthorized('Sessão expirada. Entre de novo.');
  }

  const user = await usersRepo.findUserById(stored.user_id);

  if (!user || !user.is_active) {
    await sessionsRepo.revokeAllUserTokens(stored.user_id, 'logout');
    throw AppError.forbidden('Esta conta está desactivada.');
  }

  // Rotação: emitir o novo antes de gastar o antigo, e deixar registado qual
  // substituiu qual.
  const result = await issueSession(user, actor);
  const newToken = await sessionsRepo.findRefreshTokenByHash(
    hashRefreshToken(result.refreshToken),
  );

  await sessionsRepo.revokeRefreshToken(stored.id, 'rotated', newToken?.id ?? null);
  await sessionsRepo.markRefreshTokenUsed(stored.id);

  return result;
}

export async function logout(refreshToken: string, actor?: Actor): Promise<void> {
  const stored = await sessionsRepo.findRefreshTokenByHash(hashRefreshToken(refreshToken));

  // Sair de uma sessão que já não existe não é erro: o resultado desejado
  // (a sessão não vale) já está garantido.
  if (!stored || stored.revoked_at) return;

  await sessionsRepo.revokeRefreshToken(stored.id, 'logout');

  await recordAudit({
    action: AUTH_ACTIONS.logout,
    entityType: 'users',
    entityId: stored.user_id,
    actor: { ...actor, userId: stored.user_id },
  });
}

/** Fecha todas as sessões do utilizador — «terminar sessão em todos os dispositivos». */
export async function logoutEverywhere(userId: string, actor?: Actor): Promise<number> {
  const closed = await sessionsRepo.revokeAllUserTokens(userId, 'logout');

  await recordAudit({
    action: AUTH_ACTIONS.logout,
    entityType: 'users',
    entityId: userId,
    newValue: { sessionsClosed: closed, scope: 'all_devices' },
    actor,
  });

  return closed;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  actor?: Actor,
): Promise<void> {
  const user = await usersRepo.findUserById(userId);

  if (!user) {
    throw AppError.notFound('Utilizador não encontrado.');
  }

  const withHash = await usersRepo.findUserForAuthentication(user.email);

  if (!withHash || !(await verifyPassword(withHash.password_hash, currentPassword))) {
    throw AppError.unauthorized('A password actual está incorrecta.');
  }

  if (await verifyPassword(withHash.password_hash, newPassword)) {
    throw AppError.badRequest('A nova password tem de ser diferente da actual.');
  }

  await usersRepo.updatePassword(userId, await hashPassword(newPassword));

  // Mudar a password fecha todas as sessões. Se a mudança foi motivada por
  // suspeita de acesso indevido, deixar as outras sessões abertas anularia o
  // efeito da própria mudança.
  await sessionsRepo.revokeAllUserTokens(userId, 'password_changed');

  await recordAudit({
    action: AUTH_ACTIONS.passwordChanged,
    entityType: 'users',
    entityId: userId,
    actor: { ...actor, userId },
  });
}

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role: UserRole;
}

export async function createUser(
  input: CreateUserInput,
  actor?: Actor,
): Promise<AuthenticatedUser> {
  try {
    const row = await usersRepo.insertUser({
      email: input.email,
      passwordHash: await hashPassword(input.password),
      name: input.name,
      role: input.role,
    });

    await recordAudit({
      action: AUTH_ACTIONS.userCreated,
      entityType: 'users',
      entityId: row.id,
      newValue: { email: row.email, name: row.name, role: row.role },
      actor,
    });

    return toAuthenticatedUser(row);
  } catch (error) {
    const candidate = error as { code?: string };

    if (candidate.code === '23505') {
      throw AppError.conflict('Já existe um utilizador com este e-mail.');
    }
    throw error;
  }
}

/**
 * Confirma que um access token continua válido para este utilizador.
 *
 * Além da assinatura (verificada antes), há duas razões para recusar um token
 * ainda dentro da validade: a conta foi desactivada, ou a password mudou
 * depois de o token ter sido emitido.
 */
export async function resolveTokenUser(
  userId: string,
  issuedAtMs: number,
): Promise<SafeUserRow> {
  const user = await usersRepo.findUserById(userId);

  if (!user) {
    throw AppError.unauthorized('Sessão inválida.');
  }

  if (!user.is_active) {
    throw AppError.forbidden('Esta conta está desactivada.');
  }

  // Comparação exacta, em milissegundos. Qualquer folga aqui deixaria
  // sobreviver tokens emitidos imediatamente antes da mudança de password —
  // que são precisamente os que interessa invalidar.
  if (issuedAtMs < user.tokens_valid_from.getTime()) {
    throw AppError.unauthorized('Sessão terminada. Entre de novo.');
  }

  return user;
}
