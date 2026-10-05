/** Resposta de `GET /api/health`. Espelha o tipo do backend. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: 'wim-backend';
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  environment: 'development' | 'test' | 'production';
  features: {
    whatsapp: boolean;
    ai: boolean;
  };
  database: {
    connected: boolean;
    latencyMs: number;
    serverVersion?: string;
    error?: string;
  };
}
