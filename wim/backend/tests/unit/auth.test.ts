/**
 * A camada criptográfica da autenticação.
 *
 * Estes testes não tocam na base de dados: verificam as primitivas de que
 * tudo o resto depende. Se alguma delas falhar, nenhuma protecção acima vale.
 */
import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import {
  DUMMY_HASH,
  hashPassword,
  passwordSchema,
  verifyPassword,
} from '../../src/auth/password.js';
import {
  durationToSeconds,
  extractBearerToken,
  generateRefreshToken,
  hashRefreshToken,
  InvalidTokenError,
  safeCompare,
  signAccessToken,
  verifyAccessToken,
} from '../../src/auth/tokens.js';
import { roleSatisfies } from '../../src/middleware/authenticate.js';
import { fillSecrets } from '../../src/cli/setup-env.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('passwords', () => {
  it('produz um hash argon2id', async () => {
    const hash = await hashPassword('uma-password-longa-2026');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('uma-password-longa-2026');
  });

  it('gera hashes diferentes para a mesma password', async () => {
    // Salt aleatório: duas contas com a mesma password não ficam iguais na
    // base de dados, e uma tabela pré-calculada não serve de nada.
    const a = await hashPassword('mesma-password-2026');
    const b = await hashPassword('mesma-password-2026');

    expect(a).not.toBe(b);
  });

  it('confirma a password correcta e recusa a errada', async () => {
    const hash = await hashPassword('password-correcta-2026');

    expect(await verifyPassword(hash, 'password-correcta-2026')).toBe(true);
    expect(await verifyPassword(hash, 'password-errada-2026')).toBe(false);
  });

  it('devolve falso, e não erro, perante um hash corrompido', async () => {
    // Um registo estragado na base de dados significa "não confere", não uma
    // falha do servidor que deixasse o login inacessível.
    expect(await verifyPassword('lixo-que-nao-e-hash', 'qualquer')).toBe(false);
    expect(await verifyPassword('', 'qualquer')).toBe(false);
  });

  it('o hash falso é um argon2id válido e nunca confere', async () => {
    // É usado quando o e-mail não existe, para o tempo de resposta não
    // denunciar que contas são reais. Tem de ser verificável.
    expect(DUMMY_HASH).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(DUMMY_HASH, 'qualquer-coisa')).toBe(false);
  });

  it('demora o suficiente para travar força bruta', async () => {
    const inicio = performance.now();
    await hashPassword('password-de-medicao-2026');
    const duracao = performance.now() - inicio;

    // Rápido de mais significaria parâmetros fracos. O limite superior é
    // generoso: uma máquina lenta não deve fazer falhar a suite.
    expect(duracao).toBeGreaterThan(5);
    expect(duracao).toBeLessThan(3000);
  });
});

describe('regras da password', () => {
  it('exige pelo menos 12 caracteres', () => {
    expect(passwordSchema.safeParse('curta').success).toBe(false);
    expect(passwordSchema.safeParse('doze-caracts').success).toBe(true);
  });

  it('recusa as escolhas mais óbvias', () => {
    for (const comum of ['password', 'PASSWORD', 'qwertyuiop', 'administrador']) {
      expect(passwordSchema.safeParse(comum).success, comum).toBe(false);
    }
  });

  it('recusa repetição do mesmo carácter', () => {
    expect(passwordSchema.safeParse('aaaaaaaaaaaaaaa').success).toBe(false);
  });

  it('aceita uma frase longa', () => {
    // Uma frase é mais forte e mais fácil de lembrar do que "P@ssw0rd!".
    expect(passwordSchema.safeParse('a minha obra em nacala 2026').success).toBe(true);
  });

  it('recusa passwords absurdamente longas', () => {
    // Um pedido enorme obrigaria o servidor a calcular um hash caríssimo.
    expect(passwordSchema.safeParse('a'.repeat(500)).success).toBe(false);
  });
});

describe('access tokens', () => {
  it('emite e verifica um token', async () => {
    const token = await signAccessToken(USER_ID, 'OWNER');
    const claims = await verifyAccessToken(token);

    expect(claims.sub).toBe(USER_ID);
    expect(claims.role).toBe('OWNER');
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it('inclui a emissão em milissegundos', async () => {
    // O `iat` padrão só tem resolução de segundos, e isso não chega para
    // invalidar tokens emitidos no mesmo segundo da mudança de password.
    const antes = Date.now();
    const claims = await verifyAccessToken(await signAccessToken(USER_ID, 'AGENT'));

    expect(claims.iatMs).toBeGreaterThanOrEqual(antes);
    expect(claims.iatMs).toBeLessThanOrEqual(Date.now());
  });

  it('recusa um token assinado com outro segredo', async () => {
    const forjado = await new SignJWT({ role: 'OWNER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_ID)
      .setIssuer('wim')
      .setAudience('wim-api')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('outro-segredo-completamente-diferente'));

    await expect(verifyAccessToken(forjado)).rejects.toThrow(InvalidTokenError);
  });

  it('recusa um emissor ou destinatário diferentes', async () => {
    const secret = new TextEncoder().encode(process.env['JWT_ACCESS_SECRET']!);

    const outroEmissor = await new SignJWT({ role: 'OWNER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_ID)
      .setIssuer('outro-sistema')
      .setAudience('wim-api')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    await expect(verifyAccessToken(outroEmissor)).rejects.toThrow(InvalidTokenError);
  });

  it('recusa lixo', async () => {
    for (const lixo of ['', 'nao-e-token', 'a.b.c', 'Bearer xyz']) {
      await expect(verifyAccessToken(lixo)).rejects.toThrow(InvalidTokenError);
    }
  });
});

describe('refresh tokens', () => {
  it('gera valores diferentes de cada vez', () => {
    const valores = new Set(
      Array.from({ length: 100 }, () => generateRefreshToken().token),
    );

    expect(valores.size).toBe(100);
  });

  it('tem entropia suficiente', () => {
    // 32 bytes em base64url dão 43 caracteres.
    expect(generateRefreshToken().token).toHaveLength(43);
  });

  it('o hash é SHA-256 e não permite recuperar o token', () => {
    const { token, hash } = generateRefreshToken();

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    // O mesmo token dá sempre o mesmo hash — é assim que o procuramos.
    expect(hashRefreshToken(token)).toBe(hash);
  });

  it('tokens diferentes dão hashes diferentes', () => {
    expect(hashRefreshToken('token-a')).not.toBe(hashRefreshToken('token-b'));
  });
});

describe('safeCompare', () => {
  it('compara correctamente', () => {
    expect(safeCompare('abc', 'abc')).toBe(true);
    expect(safeCompare('abc', 'abd')).toBe(false);
  });

  it('lida com comprimentos diferentes sem rebentar', () => {
    expect(safeCompare('abc', 'abcdef')).toBe(false);
    expect(safeCompare('', 'abc')).toBe(false);
    expect(safeCompare('', '')).toBe(true);
  });
});

describe('extractBearerToken', () => {
  it('lê o token do cabeçalho', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
    expect(extractBearerToken('  Bearer abc123  ')).toBe('abc123');
  });

  it('devolve nulo quando não há token utilizável', () => {
    for (const header of [undefined, '', 'abc123', 'Basic abc123', 'Bearer', 'Bearer  ']) {
      expect(extractBearerToken(header), String(header)).toBeNull();
    }
  });

  it('é sensível a maiúsculas no esquema, como manda a norma', () => {
    expect(extractBearerToken('bearer abc123')).toBeNull();
  });
});

describe('hierarquia de papéis', () => {
  it('o proprietário pode tudo', () => {
    for (const minimo of ['OWNER', 'ADMIN', 'AGENT'] as const) {
      expect(roleSatisfies('OWNER', minimo)).toBe(true);
    }
  });

  it('o administrador pode tudo menos o que é exclusivo do proprietário', () => {
    expect(roleSatisfies('ADMIN', 'OWNER')).toBe(false);
    expect(roleSatisfies('ADMIN', 'ADMIN')).toBe(true);
    expect(roleSatisfies('ADMIN', 'AGENT')).toBe(true);
  });

  it('o agente só pode o que é de agente', () => {
    expect(roleSatisfies('AGENT', 'OWNER')).toBe(false);
    expect(roleSatisfies('AGENT', 'ADMIN')).toBe(false);
    expect(roleSatisfies('AGENT', 'AGENT')).toBe(true);
  });
});

describe('durationToSeconds', () => {
  it('converte cada unidade', () => {
    expect(durationToSeconds('30s')).toBe(30);
    expect(durationToSeconds('15m')).toBe(900);
    expect(durationToSeconds('1h')).toBe(3600);
    expect(durationToSeconds('30d')).toBe(2_592_000);
  });

  it('recusa formatos inválidos', () => {
    expect(() => durationToSeconds('15')).toThrow(/Duração inválida/);
  });
});

describe('setup:env', () => {
  const template = [
    'NODE_ENV=development',
    'JWT_ACCESS_SECRET=',
    'JWT_REFRESH_SECRET=',
    'ANTHROPIC_API_KEY=',
    '# um comentário',
    '',
  ].join('\n');

  it('preenche apenas os segredos indicados', () => {
    const resultado = fillSecrets(template, ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']);

    expect(resultado).toMatch(/JWT_ACCESS_SECRET=.{40,}/);
    expect(resultado).toMatch(/JWT_REFRESH_SECRET=.{40,}/);
    // O que não foi pedido fica vazio.
    expect(resultado).toContain('ANTHROPIC_API_KEY=');
    expect(resultado).not.toMatch(/ANTHROPIC_API_KEY=.+/);
  });

  it('gera segredos diferentes para access e refresh', () => {
    const linhas = fillSecrets(template, ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']).split('\n');

    const acesso = linhas.find((l) => l.startsWith('JWT_ACCESS_SECRET='));
    const refresh = linhas.find((l) => l.startsWith('JWT_REFRESH_SECRET='));

    expect(acesso).not.toBe(refresh);
  });

  it('não toca num valor já preenchido', () => {
    const comValor = 'JWT_ACCESS_SECRET=ja-tinha-um-valor';
    expect(fillSecrets(comValor, ['JWT_ACCESS_SECRET'])).toBe(comValor);
  });

  it('preserva comentários e linhas em branco', () => {
    const resultado = fillSecrets(template, ['JWT_ACCESS_SECRET']);

    expect(resultado).toContain('# um comentário');
    expect(resultado).toContain('NODE_ENV=development');
  });
});
