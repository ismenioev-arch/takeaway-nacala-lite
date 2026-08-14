/**
 * Passwords (especificação, secção 25).
 *
 * argon2id: resistente tanto a ataques por GPU como aos que exploram o tempo
 * de acesso à memória. Os parâmetros seguem as recomendações da OWASP —
 * 19 MiB de memória, 2 iterações, 1 grau de paralelismo — que dão uma
 * verificação na ordem das dezenas de milissegundos: lenta o suficiente para
 * travar força bruta, rápida o suficiente para não atrasar o login.
 */
import argon2 from 'argon2';
import { z } from 'zod';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} satisfies argon2.HashOptions;

/**
 * Hash usado para comparar quando o utilizador não existe.
 *
 * Sem isto, um pedido para um e-mail inexistente responderia mais depressa do
 * que um para um e-mail real — e essa diferença de tempo permitiria descobrir
 * que contas existem. Verificamos sempre contra alguma coisa.
 */
export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$' +
  'RdescudvJCsgt3ub+b+dWRWJTmaaJObG';

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

/**
 * Confirma a password. Nunca lança: um hash corrompido na base de dados
 * significa "não confere", não uma falha do servidor.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Regras da password.
 *
 * Comprimento acima de tudo: uma frase longa é mais forte e mais fácil de
 * lembrar do que "P@ssw0rd!". Exigimos 12 caracteres e recusamos as escolhas
 * mais óbvias, sem impor combinações de símbolos que só levam as pessoas a
 * escrever a password num papel.
 *
 * O máximo de 200 evita que um pedido enorme obrigue o servidor a calcular um
 * hash caríssimo.
 */
const COMMON_PASSWORDS = [
  'password',
  'passw0rd',
  '123456789012',
  'qwertyuiop',
  'administrador',
  'palavrapasse',
  'wim123456789',
];

export const passwordSchema = z
  .string()
  .min(12, 'deve ter pelo menos 12 caracteres')
  .max(200, 'não pode ter mais de 200 caracteres')
  .refine(
    (value) => !COMMON_PASSWORDS.includes(value.toLowerCase()),
    'esta password é demasiado comum — escolha outra',
  )
  .refine(
    (value) => new Set(value).size >= 5,
    'use mais variedade de caracteres',
  );
