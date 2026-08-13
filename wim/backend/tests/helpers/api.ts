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
