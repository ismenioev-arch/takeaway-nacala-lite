/**
 * Cliente HTTP da API do WIM.
 *
 * Todos os pedidos ao backend passam por aqui. Em desenvolvimento o Vite
 * encaminha `/api` para o backend, por isso não há URLs diferentes entre
 * ambientes nem problemas de CORS.
 */
import type { ApiErrorBody } from '@/types/api';
import type { HealthResponse } from '@/types/health';

/** Erro devolvido pela API, já traduzido para algo que a interface pode mostrar. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    // Falha de rede: o backend não está a correr, ou não há ligação.
    throw new ApiError(0, 'NETWORK_ERROR', 'Não foi possível contactar o servidor.');
  }

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  const body: unknown = isJson ? await response.json() : null;

  if (!response.ok) {
    const parsed = body as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      parsed?.error?.code ?? 'UNKNOWN',
      parsed?.error?.message ?? `Erro ${response.status}`,
      parsed?.error?.requestId,
    );
  }

  return body as T;
}

export const api = {
  health: (): Promise<HealthResponse> => request<HealthResponse>('/api/health'),
};
