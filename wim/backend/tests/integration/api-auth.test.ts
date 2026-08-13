/**
 * Autenticação (especificação, secção 25).
 *
 * Estes testes tentam entrar sem credenciais, com credenciais erradas, com
 * tokens forjados, com tokens roubados e com tokens já gastos. Se algum deles
 * conseguir passar, o painel inteiro está aberto.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { closePool, getPool } from '../../src/database/pool.js';
import { hashPassword } from '../../src/auth/password.js';
import { insertUser } from '../../src/repositories/users.repository.js';
import type { LoginResult } from '../../src/services/auth.service.js';
import { freshSchema } from '../helpers/fixtures.js';
import { call, startTestApp, type ApiErrorBody } from '../helpers/api.js';

let app: FastifyInstance;

const OWNER = { email: 'dono@exemplo.mz', password: 'obra-nacala-2026-segura', name: 'Dono' };
const AGENT = { email: 'agente@exemplo.mz', password: 'atendimento-2026-forte', name: 'Agente' };

let ownerId: string;
let agentId: string;

async function login(email: string, password: string) {
  return call<LoginResult>(app, {
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
}

/** Cabeçalho `Authorization` pronto a usar. */
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  await freshSchema();

  ownerId = (
    await insertUser({
      email: OWNER.email,
      passwordHash: await hashPassword(OWNER.password),
      name: OWNER.name,
      role: 'OWNER',
    })
  ).id;

  agentId = (
    await insertUser({
      email: AGENT.email,
      passwordHash: await hashPassword(AGENT.password),
      name: AGENT.name,
      role: 'AGENT',
    })
  ).id;

  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
  await closePool();
});

describe('POST /api/auth/login', () => {
  it('entra com credenciais correctas', async () => {
    const { status, body } = await login(OWNER.email, OWNER.password);

    expect(status).toBe(200);
    expect(body.user).toMatchObject({ email: OWNER.email, role: 'OWNER' });
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.expiresIn).toBe(900); // 15 minutos
  });

  it('nunca devolve o hash da password', async () => {
    const { body } = await login(OWNER.email, OWNER.password);

    expect(JSON.stringify(body)).not.toContain('argon2');
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.user).not.toHaveProperty('password_hash');
  });

  it('aceita o e-mail com maiúsculas', async () => {
    const { status } = await login('DONO@EXEMPLO.MZ', OWNER.password);
    expect(status).toBe(200);
  });

  it('recusa a password errada', async () => {
    const { status, body } = await call<ApiErrorBody>(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: OWNER.email, password: 'password-errada-mas-longa' },
    });

    expect(status).toBe(401);
    expect(body.error.message).toBe('E-mail ou password incorrectos.');
  });

  it('dá exactamente a mesma mensagem para um e-mail que não existe', async () => {
    // Uma mensagem diferente entregaria a lista de contas a quem tentasse
    // adivinhar quais existem.
    const inexistente = await call<ApiErrorBody>(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nao-existe@exemplo.mz', password: 'qualquer-coisa-longa' },
    });

    expect(inexistente.status).toBe(401);
    expect(inexistente.error?.message ?? inexistente.body.error.message).toBe(
      'E-mail ou password incorrectos.',
    );
  });

  it('regista a tentativa falhada sem guardar a password', async () => {
    const result = await getPool().query<{ email: string; failure_reason: string }>(
      `SELECT email, failure_reason FROM login_attempts WHERE NOT succeeded ORDER BY created_at`,
    );

    expect(result.rowCount).toBeGreaterThan(0);

    const colunas = await getPool().query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'login_attempts'`,
    );
    const nomes = colunas.rows.map((r) => r.column_name);

    expect(nomes).not.toContain('password');
    expect(nomes).not.toContain('password_hash');
  });

  it('regista a entrada bem sucedida na auditoria', async () => {
    const result = await getPool().query(
      `SELECT id FROM audit_logs WHERE action = 'auth.login' AND entity_id = $1`,
      [ownerId],
    );

    expect(result.rowCount).toBeGreaterThan(0);
  });

  it('recusa um e-mail mal formado', async () => {
    const { status } = await call(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nao-e-email', password: 'qualquer-coisa' },
    });

    expect(status).toBe(400);
  });

  it('recusa uma conta desactivada, mesmo com a password certa', async () => {
    await getPool().query(`UPDATE users SET is_active = false WHERE id = $1`, [agentId]);

    const { status, body } = await call<ApiErrorBody>(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: AGENT.email, password: AGENT.password },
    });

    expect(status).toBe(403);
    expect(body.error.message).toContain('desactivada');

    await getPool().query(`UPDATE users SET is_active = true WHERE id = $1`, [agentId]);
  });
});

describe('travão de força bruta', () => {
  const ALVO = 'alvo@exemplo.mz';

  beforeAll(async () => {
    await insertUser({
      email: ALVO,
      passwordHash: await hashPassword('password-do-alvo-2026'),
      name: 'Alvo',
      role: 'AGENT',
    });
  });

  it('bloqueia depois de demasiadas falhas seguidas', async () => {
    let bloqueado = false;

    for (let i = 0; i < 12; i += 1) {
      const { status } = await call<ApiErrorBody>(app, {
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: ALVO, password: `tentativa-errada-${i}` },
      });

      if (status === 429) {
        bloqueado = true;
        break;
      }
    }

    expect(bloqueado).toBe(true);
  });

  it('continua bloqueado mesmo com a password correcta', async () => {
    // Se a password certa passasse durante o bloqueio, o travão não travava
    // nada: bastaria continuar a adivinhar.
    const { status } = await call<ApiErrorBody>(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ALVO, password: 'password-do-alvo-2026' },
    });

    expect(status).toBe(429);
  });

  it('desbloqueia quando as falhas saem da janela de tempo', async () => {
    await getPool().query(
      `UPDATE login_attempts SET created_at = now() - interval '20 minutes' WHERE email = $1`,
      [ALVO],
    );

    const { status } = await call(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ALVO, password: 'password-do-alvo-2026' },
    });

    expect(status).toBe(200);
  });
});

describe('endpoints protegidos', () => {
  it('recusa sem cabeçalho Authorization', async () => {
    const { status, body } = await call<ApiErrorBody>(app, {
      method: 'GET',
      url: '/api/contacts',
    });

    expect(status).toBe(401);
    expect(body.error.message).toContain('iniciar sessão');
  });

  it('recusa um token inventado', async () => {
    const { status } = await call(app, {
      method: 'GET',
      url: '/api/contacts',
      headers: bearer('isto.nao.e.um.token'),
    });

    expect(status).toBe(401);
  });

  it('recusa um token assinado com outro segredo', async () => {
    // O ataque óbvio: forjar um token com o conteúdo certo mas outra chave.
    const forjado = await new SignJWT({ role: 'OWNER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ownerId)
      .setIssuer('wim')
      .setAudience('wim-api')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('segredo-errado-do-atacante-1234567890'));

    const { status } = await call(app, {
      method: 'GET',
      url: '/api/contacts',
      headers: bearer(forjado),
    });

    expect(status).toBe(401);
  });

  it('recusa um token sem assinatura (algoritmo "none")', async () => {
    const semAssinatura =
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') +
      '.' +
      Buffer.from(
        JSON.stringify({ sub: ownerId, role: 'OWNER', iss: 'wim', aud: 'wim-api' }),
      ).toString('base64url') +
      '.';

    const { status } = await call(app, {
      method: 'GET',
      url: '/api/contacts',
      headers: bearer(semAssinatura),
    });

    expect(status).toBe(401);
  });

  it('recusa um token expirado', async () => {
    const expirado = await new SignJWT({ role: 'OWNER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ownerId)
      .setIssuer('wim')
      .setAudience('wim-api')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(process.env['JWT_ACCESS_SECRET']!));

    const { status } = await call(app, {
      method: 'GET',
      url: '/api/contacts',
      headers: bearer(expirado),
    });

    expect(status).toBe(401);
  });

  it('recusa um refresh token apresentado como access token', async () => {
    // Os dois têm finalidades diferentes e segredos diferentes.
    const { body } = await login(OWNER.email, OWNER.password);

    const { status } = await call(app, {
      method: 'GET',
      url: '/api/contacts',
      headers: bearer(body.refreshToken),
    });

    expect(status).toBe(401);
  });

  it('aceita um token válido', async () => {
    const { body } = await login(OWNER.email, OWNER.password);

    const { status } = await call(app, {
      method: 'GET',
      url: '/api/contacts',
      headers: bearer(body.accessToken),
    });

    expect(status).toBe(200);
  });

  it('protege todos os endpoints da FASE 3', async () => {
    const rotas: Array<[string, string]> = [
      ['GET', '/api/contacts'],
      ['GET', '/api/conversations'],
      ['GET', '/api/conversations/attention'],
      ['GET', '/api/conversations/counts'],
      ['GET', '/api/messages?conversationId=00000000-0000-4000-8000-000000000000'],
      ['GET', '/api/search?q=teste'],
      ['POST', '/api/contacts'],
    ];

    for (const [method, url] of rotas) {
      const { status } = await call(app, { method: method as 'GET', url, payload: {} });
      expect(status, `${method} ${url} devia exigir sessão`).toBe(401);
    }
  });

  it('deixa /api/health público, para as sondas automáticas', async () => {
    const { status } = await call(app, { method: 'GET', url: '/api/health' });
    expect(status).toBe(200);
  });
});

describe('GET /api/auth/me', () => {
  it('devolve o utilizador da sessão', async () => {
    const { body } = await login(OWNER.email, OWNER.password);

    const { status, body: me } = await call<{
      user: { email: string; role: string };
      activeSessions: number;
    }>(app, {
      method: 'GET',
      url: '/api/auth/me',
      headers: bearer(body.accessToken),
    });

    expect(status).toBe(200);
    expect(me.user.email).toBe(OWNER.email);
    expect(me.activeSessions).toBeGreaterThan(0);
  });
});

describe('renovação de sessão', () => {
  it('troca o refresh token por um par novo', async () => {
    const inicial = await login(OWNER.email, OWNER.password);

    const { status, body } = await call<LoginResult>(app, {
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: inicial.body.refreshToken },
    });

    expect(status).toBe(200);
    // Rotação: o token novo tem de ser diferente do antigo.
    expect(body.refreshToken).not.toBe(inicial.body.refreshToken);
    expect(body.accessToken).toBeTruthy();
  });

  it('o token antigo deixa de servir', async () => {
    const inicial = await login(OWNER.email, OWNER.password);
    await call(app, {
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: inicial.body.refreshToken },
    });

    const reutilizado = await call<ApiErrorBody>(app, {
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: inicial.body.refreshToken },
    });

    expect(reutilizado.status).toBe(401);
  });

  it('reutilizar um token gasto fecha TODAS as sessões do utilizador', async () => {
    // O cenário do roubo: o atacante copia o token, o dono renova, e depois o
    // atacante tenta usar a cópia. Nesse momento fechamos tudo.
    const primeira = await login(AGENT.email, AGENT.password);
    const segunda = await login(AGENT.email, AGENT.password);

    // O dono renova a primeira sessão.
    const renovada = await call<LoginResult>(app, {
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: primeira.body.refreshToken },
    });
    expect(renovada.status).toBe(200);

    // O atacante usa a cópia antiga.
    const roubo = await call<ApiErrorBody>(app, {
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: primeira.body.refreshToken },
    });

    expect(roubo.status).toBe(401);
    expect(roubo.body.error.message).toContain('todas as sessões foram fechadas');

    // A sessão renovada e a outra sessão paralela também caem.
    for (const token of [renovada.body.refreshToken, segunda.body.refreshToken]) {
      const depois = await call(app, {
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { refreshToken: token },
      });
      expect(depois.status).toBe(401);
    }

    const audit = await getPool().query(
      `SELECT id FROM audit_logs WHERE action = 'auth.refresh_reuse_detected'`,
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('recusa um refresh token inventado', async () => {
    const { status } = await call(app, {
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: 'token-que-nunca-existiu' },
    });

    expect(status).toBe(401);
  });

  it('recusa um refresh token expirado', async () => {
    const sessao = await login(OWNER.email, OWNER.password);

    // A constraint exige expires_at > created_at, por isso recuamos as duas
    // datas em vez de só a validade.
    await getPool().query(
      `UPDATE refresh_tokens
          SET created_at = now() - interval '31 days',
              expires_at = now() - interval '1 day'
        WHERE revoked_at IS NULL AND user_id = $1`,
      [ownerId],
    );

    const { status, body } = await call<ApiErrorBody>(app, {
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: sessao.body.refreshToken },
    });

    expect(status).toBe(401);
    expect(body.error.message).toContain('expirada');
  });
});

describe('a base de dados nunca guarda um segredo utilizável', () => {
  it('guarda o refresh token apenas como SHA-256', async () => {
    const { body } = await login(OWNER.email, OWNER.password);

    const guardado = await getPool().query<{ token_hash: string }>(
      `SELECT token_hash FROM refresh_tokens WHERE revoked_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
    );

    const hash = guardado.rows[0]!.token_hash;

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(body.refreshToken);
    expect(hash).not.toContain(body.refreshToken);
  });

  it('a constraint recusa guardar um token em claro', async () => {
    await expect(
      getPool().query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, 'este-e-o-token-em-claro', now() + interval '1 day')`,
        [ownerId],
      ),
    ).rejects.toThrow(/refresh_tokens_hash_is_sha256/);
  });

  it('guarda a password apenas como argon2id', async () => {
    const result = await getPool().query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [ownerId],
    );

    expect(result.rows[0]!.password_hash).toMatch(/^\$argon2id\$/);
    expect(result.rows[0]!.password_hash).not.toContain(OWNER.password);
  });
});

describe('terminar sessão', () => {
  it('invalida o refresh token', async () => {
    const sessao = await login(OWNER.email, OWNER.password);

    const saida = await call(app, {
      method: 'POST',
      url: '/api/auth/logout',
      payload: { refreshToken: sessao.body.refreshToken },
    });
    expect(saida.status).toBe(204);

    const depois = await call(app, {
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: sessao.body.refreshToken },
    });
    expect(depois.status).toBe(401);
  });

  it('sair duas vezes não é erro', async () => {
    const sessao = await login(OWNER.email, OWNER.password);

    for (let i = 0; i < 2; i += 1) {
      const { status } = await call(app, {
        method: 'POST',
        url: '/api/auth/logout',
        payload: { refreshToken: sessao.body.refreshToken },
      });
      expect(status).toBe(204);
    }
  });

  it('logout-all fecha todas as sessões', async () => {
    const a = await login(AGENT.email, AGENT.password);
    await login(AGENT.email, AGENT.password);

    const { status, body } = await call<{ sessionsClosed: number }>(app, {
      method: 'POST',
      url: '/api/auth/logout-all',
      headers: bearer(a.body.accessToken),
    });

    expect(status).toBe(200);
    expect(body.sessionsClosed).toBeGreaterThanOrEqual(2);
  });
});

describe('mudança de password', () => {
  const UTILIZADOR = { email: 'muda@exemplo.mz', password: 'password-inicial-2026' };

  beforeAll(async () => {
    await insertUser({
      email: UTILIZADOR.email,
      passwordHash: await hashPassword(UTILIZADOR.password),
      name: 'Muda Password',
      role: 'AGENT',
    });
  });

  it('recusa se a password actual estiver errada', async () => {
    const sessao = await login(UTILIZADOR.email, UTILIZADOR.password);

    const { status } = await call(app, {
      method: 'POST',
      url: '/api/auth/change-password',
      headers: bearer(sessao.body.accessToken),
      payload: { currentPassword: 'errada-mas-longa', newPassword: 'password-nova-2026-boa' },
    });

    expect(status).toBe(401);
  });

  it('recusa uma password nova demasiado curta', async () => {
    const sessao = await login(UTILIZADOR.email, UTILIZADOR.password);

    const { status, body } = await call<ApiErrorBody>(app, {
      method: 'POST',
      url: '/api/auth/change-password',
      headers: bearer(sessao.body.accessToken),
      payload: { currentPassword: UTILIZADOR.password, newPassword: 'curta' },
    });

    expect(status).toBe(400);
    expect(body.error.details?.[0]?.message).toContain('12 caracteres');
  });

  it('recusa repetir a mesma password', async () => {
    const sessao = await login(UTILIZADOR.email, UTILIZADOR.password);

    const { status, body } = await call<ApiErrorBody>(app, {
      method: 'POST',
      url: '/api/auth/change-password',
      headers: bearer(sessao.body.accessToken),
      payload: {
        currentPassword: UTILIZADOR.password,
        newPassword: UTILIZADOR.password,
      },
    });

    expect(status).toBe(400);
    expect(body.error.message).toContain('diferente da actual');
  });

  it('muda a password e invalida os acessos antigos', async () => {
    const sessao = await login(UTILIZADOR.email, UTILIZADOR.password);
    const novaPassword = 'password-mudada-2026-forte';

    const { status } = await call(app, {
      method: 'POST',
      url: '/api/auth/change-password',
      headers: bearer(sessao.body.accessToken),
      payload: { currentPassword: UTILIZADOR.password, newPassword: novaPassword },
    });
    expect(status).toBe(204);

    // O access token emitido antes da mudança deixa de valer, mesmo estando
    // dentro do prazo — é isso que `tokens_valid_from` garante.
    const comTokenAntigo = await call(app, {
      method: 'GET',
      url: '/api/auth/me',
      headers: bearer(sessao.body.accessToken),
    });
    expect(comTokenAntigo.status).toBe(401);

    // E o refresh token também.
    const comRefreshAntigo = await call(app, {
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: sessao.body.refreshToken },
    });
    expect(comRefreshAntigo.status).toBe(401);

    // A password nova funciona.
    const nova = await login(UTILIZADOR.email, novaPassword);
    expect(nova.status).toBe(200);
  });
});

describe('permissões por papel (secção 25)', () => {
  it('um agente não pode apagar contactos', async () => {
    const agente = await login(AGENT.email, AGENT.password);

    const contacto = await call<{ id: string }>(app, {
      method: 'POST',
      url: '/api/contacts',
      headers: bearer(agente.body.accessToken),
      payload: { phone: '+258840007777' },
    });
    expect(contacto.status).toBe(201);

    const { status, body } = await call<ApiErrorBody>(app, {
      method: 'DELETE',
      url: `/api/contacts/${contacto.body.id}`,
      headers: bearer(agente.body.accessToken),
    });

    expect(status).toBe(403);
    expect(body.error.message).toContain('permissão');
  });

  it('o proprietário pode apagar contactos', async () => {
    const dono = await login(OWNER.email, OWNER.password);

    const contacto = await call<{ id: string }>(app, {
      method: 'POST',
      url: '/api/contacts',
      headers: bearer(dono.body.accessToken),
      payload: { phone: '+258840008888' },
    });

    const { status } = await call(app, {
      method: 'DELETE',
      url: `/api/contacts/${contacto.body.id}`,
      headers: bearer(dono.body.accessToken),
    });

    expect(status).toBe(204);
  });

  it('um agente não pode listar utilizadores', async () => {
    const agente = await login(AGENT.email, AGENT.password);

    const { status } = await call(app, {
      method: 'GET',
      url: '/api/users',
      headers: bearer(agente.body.accessToken),
    });

    expect(status).toBe(403);
  });

  it('um agente não pode criar utilizadores', async () => {
    const agente = await login(AGENT.email, AGENT.password);

    const { status } = await call(app, {
      method: 'POST',
      url: '/api/users',
      headers: bearer(agente.body.accessToken),
      payload: { email: 'novo@exemplo.mz', password: 'password-longa-2026', name: 'Novo' },
    });

    expect(status).toBe(403);
  });

  it('o proprietário pode criar utilizadores', async () => {
    const dono = await login(OWNER.email, OWNER.password);

    const { status, body } = await call<{ email: string; role: string }>(app, {
      method: 'POST',
      url: '/api/users',
      headers: bearer(dono.body.accessToken),
      payload: {
        email: 'criado@exemplo.mz',
        password: 'password-do-novo-2026',
        name: 'Criado pelo Dono',
        role: 'AGENT',
      },
    });

    expect(status).toBe(201);
    expect(body.role).toBe('AGENT');
  });

  it('recusa criar um e-mail repetido com 409', async () => {
    const dono = await login(OWNER.email, OWNER.password);

    const { status } = await call(app, {
      method: 'POST',
      url: '/api/users',
      headers: bearer(dono.body.accessToken),
      payload: {
        email: 'criado@exemplo.mz',
        password: 'outra-password-2026',
        name: 'Repetido',
      },
    });

    expect(status).toBe(409);
  });
});

describe('a auditoria passa a saber quem fez o quê', () => {
  it('regista o utilizador autenticado, e já não "sistema"', async () => {
    const dono = await login(OWNER.email, OWNER.password);

    await call(app, {
      method: 'POST',
      url: '/api/contacts',
      headers: bearer(dono.body.accessToken),
      payload: { phone: '+258840009999', displayName: 'Auditado' },
    });

    const result = await getPool().query<{ user_id: string | null }>(
      `SELECT user_id FROM audit_logs
        WHERE action = 'contact.created'
        ORDER BY created_at DESC LIMIT 1`,
    );

    expect(result.rows[0]!.user_id).toBe(ownerId);
  });

  it('guarda o endereço de origem', async () => {
    const result = await getPool().query<{ ip_address: string | null }>(
      `SELECT ip_address FROM audit_logs
        WHERE action = 'contact.created' ORDER BY created_at DESC LIMIT 1`,
    );

    expect(result.rows[0]!.ip_address).toBeTruthy();
  });
});
