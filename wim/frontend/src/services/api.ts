/**
 * Cliente HTTP da API do WIM.
 *
 * Todos os pedidos ao backend passam por aqui. Em desenvolvimento o Vite
 * encaminha `/api` para o backend, por isso não há URLs diferentes entre
 * ambientes nem problemas de CORS.
 */
import type { ApiErrorBody } from '@/types/api';
import type { HealthResponse } from '@/types/health';
import type { AuthUser } from '@/types/auth';

/**
 * Onde vive a API.
 *
 * Por omissão, lado nenhum: os pedidos saem como `/api/...`, relativos à
 * página. É isso que queremos em desenvolvimento (o Vite encaminha) e na
 * Vercel (o painel e a API partilham o domínio) — sem CORS, sem URL
 * diferente por ambiente, sem nada para configurar.
 *
 * `VITE_API_URL` existe para o caso contrário: API num domínio próprio. Aí é
 * preciso acrescentar essa origem ao `CORS_ORIGIN` do backend.
 */
const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

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

/** Callback para renovar o token e obter um novo access token. */
let tokenRefreshCallback: (() => Promise<string>) | undefined;

export function setTokenRefreshCallback(callback: () => Promise<string>) {
  tokenRefreshCallback = callback;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  /** Se true, já é uma tentativa de renovação — não tentar de novo. */
  isRetry?: boolean,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Não foi possível contactar o servidor.');
  }

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  const body: unknown = isJson ? await response.json() : null;

  if (!response.ok) {
    const parsed = body as ApiErrorBody | null;

    // Se 401 e temos callback, tentar renovar o token e fazer retry
    if (response.status === 401 && !isRetry && tokenRefreshCallback) {
      try {
        const newAccessToken = await tokenRefreshCallback();
        return request<T>(
          path,
          {
            ...init,
            headers: {
              ...init?.headers,
              Authorization: `Bearer ${newAccessToken}`,
            },
          },
          true, // isRetry
        );
      } catch {
        // Falha na renovação — deixar o erro 401 passar
      }
    }

    throw new ApiError(
      response.status,
      parsed?.error?.code ?? 'UNKNOWN',
      parsed?.error?.message ?? `Erro ${response.status}`,
      parsed?.error?.requestId,
    );
  }

  return body as T;
}

function makeHeaders(accessToken?: string): HeadersInit {
  const headers: HeadersInit = { 'content-type': 'application/json' };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return headers;
}

interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface RefreshResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface ConversationCountsResponse {
  urgente: number;
  importante: number;
  acompanhar: number;
  normal: number;
  total: number;
  unanswered: number;
  awaitingApproval: number;
}

export interface ConversationSummaryDto {
  id: string;
  status: 'OPEN' | 'RESOLVED' | 'ARCHIVED';
  priority: 'URGENTE' | 'IMPORTANTE' | 'ACOMPANHAR' | 'NORMAL';
  subject: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;

  contact: {
    id: string;
    displayName: string | null;
    profileName: string | null;
    phone: string;
    company: string | null;
    category: 'CLIENTE' | 'PROSPECT' | 'LEAD' | 'OUTRO';
  };

  analysis: {
    summary: string | null;
    intent: string | null;
    urgencyReason: string | null;
    recommendedAction: string | null;
  };

  lastMessagePreview: string | null;
  pendingDrafts: number;
  awaitingReply: boolean;
  minutesSinceLastInbound: number | null;
}

export interface PendingDraftDto {
  id: string;
  conversationId: string;
  messageId: string;
  status: 'DRAFT' | 'EDITED' | 'APPROVED' | 'SENT' | 'CANCELLED' | 'FAILED';
  automationLevel: 'AUTO' | 'DRAFT' | 'HUMAN_REQUIRED';
  requiresApproval: boolean;

  content: string;
  editedContent: string | null;
  effectiveContent: string;

  contact: { id: string; name: string | null; phone: string };
  inbound: { body: string | null; type: string; timestamp: string };
  analysis: {
    priority: 'URGENTE' | 'IMPORTANTE' | 'ACOMPANHAR' | 'NORMAL' | null;
    intent: string | null;
    confidence: number | null;
    summary: string | null;
    urgencyReason: string | null;
    recommendedAction: string | null;
  };
  conversationPriority: 'URGENTE' | 'IMPORTANTE' | 'ACOMPANHAR' | 'NORMAL';
  createdAt: string;
}

interface PendingDraftsResponse {
  data: PendingDraftDto[];
  /** Falso quando a integração com o WhatsApp está desligada. */
  canSend: boolean;
}

interface SendDraftResponse {
  status: string;
  messageId: string;
  waMessageId: string;
  sentBy: { id: string; name: string };
}

interface ListResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export const api = {
  health: (): Promise<HealthResponse> => request<HealthResponse>('/api/health'),

  auth: {
    login: (email: string, password: string): Promise<LoginResponse> =>
      request<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),

    refresh: (refreshToken: string): Promise<RefreshResponse> =>
      request<RefreshResponse>('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      }),

    logout: (refreshToken: string): Promise<void> =>
      request<void>('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      }),

    me: (accessToken: string): Promise<{ user: AuthUser; activeSessions: number }> =>
      request<{ user: AuthUser; activeSessions: number }>('/api/auth/me', {
        headers: makeHeaders(accessToken),
      }),
  },

  conversations: {
    counts: (accessToken: string): Promise<ConversationCountsResponse> =>
      request<ConversationCountsResponse>('/api/conversations/counts', {
        headers: makeHeaders(accessToken),
      }),

    attention: (accessToken: string): Promise<ListResponse<ConversationSummaryDto>> =>
      request<ListResponse<ConversationSummaryDto>>('/api/conversations/attention', {
        headers: makeHeaders(accessToken),
      }),

    list: (accessToken: string, params?: Record<string, string | number | boolean>): Promise<ListResponse<ConversationSummaryDto>> => {
      const query = new URLSearchParams();
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined) {
            query.append(key, String(value));
          }
        });
      }
      const url = `/api/conversations${query.size > 0 ? `?${query}` : ''}`;
      return request<ListResponse<ConversationSummaryDto>>(url, {
        headers: makeHeaders(accessToken),
      });
    },
  },

  drafts: {
    pending: (accessToken: string): Promise<PendingDraftsResponse> =>
      request<PendingDraftsResponse>('/api/drafts', { headers: makeHeaders(accessToken) }),

    /** Guarda a edição sem enviar. */
    edit: (accessToken: string, id: string, content: string): Promise<PendingDraftDto> =>
      request<PendingDraftDto>(`/api/drafts/${id}`, {
        method: 'PATCH',
        headers: makeHeaders(accessToken),
        body: JSON.stringify({ content }),
      }),

    cancel: (accessToken: string, id: string): Promise<PendingDraftDto> =>
      request<PendingDraftDto>(`/api/drafts/${id}/cancel`, {
        method: 'POST',
        headers: makeHeaders(accessToken),
      }),

    /** Aprova e envia. O `content` permite editar e enviar num só gesto. */
    send: (accessToken: string, id: string, content?: string): Promise<SendDraftResponse> =>
      request<SendDraftResponse>(`/api/drafts/${id}/send`, {
        method: 'POST',
        headers: makeHeaders(accessToken),
        body: JSON.stringify(content === undefined ? {} : { content }),
      }),
  },
};
