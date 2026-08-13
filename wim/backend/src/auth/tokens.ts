/**
 * Tokens de acesso e de renovação.
 *
 * Dois tipos, com finalidades diferentes:
 *
 *   • **Access token** — JWT assinado, de vida curta (15 minutos). Vai em cada
 *     pedido. Não é guardado em lado nenhum: verifica-se pela assinatura.
 *
 *   • **Refresh token** — 32 bytes aleatórios, de vida longa (30 dias). Serve
 *     só para obter um novo access token. É guardado na base de dados, mas
 *     apenas como SHA-256: quem leia a base de dados não consegue usá-lo.
 *
 * Os dois usam segredos diferentes. Assim, um access token não pode ser
 * apresentado como refresh token, nem o contrário.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { getEnv } from '../config/env.js';
import type { UserRole } from '../models/enums.js';

const ISSUER = 'wim';
const AUDIENCE = 'wim-api';

export interface AccessTokenClaims {
  /** Identificador do utilizador. */
  sub: string;
  role: UserRole;
  /** Momento da emissão, em segundos (claim padrão do JWT). */
  iat: number;
  /**
   * Momento da emissão em MILISSEGUNDOS.
   *
   * O `iat` padrão só tem resolução de segundos, e isso não chega para
   * comparar com `tokens_valid_from`: um token emitido no mesmo segundo em
   * que a password mudou ficaria indistinguível de um emitido logo a seguir,
   * e sobreviveria à mudança — anulando o efeito que a coluna existe para
   * garantir.
   */
  iatMs: number;
  exp: number;
}

function accessSecret(): Uint8Array {
  const secret = getEnv().JWT_ACCESS_SECRET;

  if (!secret) {
    throw new Error(
      'JWT_ACCESS_SECRET não está definido. Gere um com: openssl rand -base64 48',
    );
  }

  return new TextEncoder().encode(secret);
}

/** Converte "15m" / "30d" em segundos. */
export function durationToSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error(`Duração inválida: "${value}"`);

  const amount = Number(match[1]);
  const factor = { s: 1, m: 60, h: 3_600, d: 86_400 }[match[2] as 's' | 'm' | 'h' | 'd'];

  return amount * factor;
}

export async function signAccessToken(userId: string, role: UserRole): Promise<string> {
  const env = getEnv();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({ role, iatMs: Date.now() })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + durationToSeconds(env.JWT_ACCESS_TTL))
    .sign(accessSecret());
}

export class InvalidTokenError extends Error {
  constructor(message = 'Token inválido ou expirado.') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  let payload: JWTPayload;

  try {
    const result = await jwtVerify(token, accessSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'], // impede o ataque de trocar o algoritmo por "none"
    });
    payload = result.payload;
  } catch {
    throw new InvalidTokenError();
  }

  if (!payload.sub || typeof payload.role !== 'string') {
    throw new InvalidTokenError();
  }

  const iat = payload.iat ?? 0;

  return {
    sub: payload.sub,
    role: payload.role as UserRole,
    iat,
    // Tokens antigos, sem o claim, caem para a resolução de segundos.
    iatMs: typeof payload['iatMs'] === 'number' ? payload['iatMs'] : iat * 1000,
    exp: payload.exp ?? 0,
  };
}

/**
 * Gera um refresh token.
 *
 * Devolve o valor em claro (que segue para o cliente e nunca é guardado) e o
 * hash (que fica na base de dados). São 32 bytes de aleatoriedade
 * criptográfica — não é um JWT, porque não precisa de transportar nada.
 */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Comparação em tempo constante.
 *
 * A comparação normal (`===`) pára no primeiro carácter diferente, e esse
 * tempo revela quantos caracteres iniciais estavam certos.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  if (bufferA.length !== bufferB.length) return false;

  return timingSafeEqual(bufferA, bufferB);
}

/** Lê o token do cabeçalho `Authorization: Bearer <token>`. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;

  const match = /^Bearer (.+)$/.exec(header.trim());
  return match?.[1]?.trim() || null;
}
