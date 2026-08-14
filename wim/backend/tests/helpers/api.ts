/**
 * Auxiliares para os testes da API.
 *
 * Usam `app.inject()`: percorrem o pipeline completo (parsers, middleware,
 * validação, rotas, tratamento de erros) sem abrir portas de rede.
 */
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../../src/app.js';

export async function startTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export interface ApiResponse<T> {
  status: number;
  body: T;
}

export async function call<T>(
  app: FastifyInstance,
  options: InjectOptions,
): Promise<ApiResponse<T>> {
  const response = await app.inject(options);

  const isJson = response.headers['content-type']?.toString().includes('application/json');

  return {
    status: response.statusCode,
    body: (isJson ? response.json() : undefined) as T,
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
    requestId: string;
  };
}

/**
 * Cria um utilizador, entra com ele e devolve um cliente já autenticado.
 *
 * A partir da FASE 4 todos os endpoints exigem sessão, por isso os testes que
 * exercitam a API precisam de um token. Concentrar isto aqui evita repetir o
 * cabeçalho `Authorization` em cada chamada.
 */
export interface AuthenticatedClient {
  userId: string;
  token: string;
  headers: { authorization: string };
  /** Como `call`, mas já com a sessão iniciada. */
  call: <T>(options: InjectOptions) => Promise<ApiResponse<T>>;
}

export async function authenticateAs(
  app: FastifyInstance,
  options: { email?: string; password?: string; name?: string; role?: string } = {},
): Promise<AuthenticatedClient> {
  const { hashPassword } = await import('../../src/auth/password.js');
  const { insertUser } = await import('../../src/repositories/users.repository.js');

  const email = options.email ?? `teste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemplo.mz`;
  const password = options.password ?? 'password-de-teste-2026';

  const user = await insertUser({
    email,
    passwordHash: await hashPassword(password),
    name: options.name ?? 'Utilizador de Teste',
    role: (options.role ?? 'OWNER') as 'OWNER' | 'ADMIN' | 'AGENT',
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });

  if (response.statusCode !== 200) {
    throw new Error(`Não foi possível autenticar nos testes: ${response.body}`);
  }

  const token = (response.json() as { accessToken: string }).accessToken;
  const headers = { authorization: `Bearer ${token}` };

  return {
    userId: user.id,
    token,
    headers,
    call: <T>(injectOptions: InjectOptions) =>
      call<T>(app, {
        ...injectOptions,
        headers: { ...headers, ...injectOptions.headers },
      }),
  };
}

/** Constrói uma query string a partir de um objecto, ignorando indefinidos. */
export function query(params: Record<string, string | number | string[] | undefined>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    } else {
      search.append(key, String(value));
    }
  }

  const rendered = search.toString();
  return rendered ? `?${rendered}` : '';
}
