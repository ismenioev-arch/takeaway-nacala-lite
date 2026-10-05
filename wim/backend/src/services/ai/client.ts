/**
 * A ligação à Claude.
 *
 * Isolada atrás de uma interface pequena por duas razões práticas. A
 * primeira é que os testes não podem depender da rede nem de uma chave de
 * API: toda a suite corre com um cliente falso. A segunda é que o resto do
 * sistema não deve saber nada sobre cabeçalhos HTTP, formatos de `tool_use`
 * ou códigos de erro da Anthropic — pede uma análise e recebe um objecto.
 */
import { getEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ANALYSIS_TOOL_NAME, analysisJsonSchema } from './schema.js';

export interface AiRequest {
  system: string;
  user: string;
}

export interface AiCompletion {
  /** O JSON devolvido pelo modelo, ainda por validar. */
  data: unknown;
  model: string;
  tokensInput: number | null;
  tokensOutput: number | null;
  latencyMs: number;
}

export interface AiClient {
  analyze(request: AiRequest): Promise<AiCompletion>;
}

/**
 * Falha que vale a pena tentar outra vez mais tarde.
 *
 * A distinção não é académica: um erro transitório devolve a mensagem à
 * fila, um erro definitivo marca-a como falhada. Trocar os dois significa
 * ou perder mensagens ou repeti-las para sempre.
 */
export class AiTransientError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiTransientError';
  }
}

/** Falha que não melhora com insistência: chave inválida, pedido malformado. */
export class AiPermanentError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiPermanentError';
  }
}

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Esforço configurado → espaço que o modelo tem para pensar e escrever.
 *
 * Classificar uma mensagem de WhatsApp não precisa de muito. O tecto
 * existe para que um prompt mal formulado não gere uma resposta de dez mil
 * tokens que ninguém vai ler e todos vão pagar.
 */
const MAX_TOKENS_BY_EFFORT: Record<string, number> = {
  low: 1024,
  medium: 2048,
  high: 4096,
  xhigh: 8192,
  max: 16_384,
};

interface AnthropicContentBlock {
  type: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  model?: string;
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

/** O cliente verdadeiro. Em testes nunca é construído. */
export function createAnthropicClient(): AiClient {
  return {
    async analyze(request: AiRequest): Promise<AiCompletion> {
      const env = getEnv();
      const apiKey = env.ANTHROPIC_API_KEY;

      if (!apiKey) {
        throw new AiPermanentError('ANTHROPIC_API_KEY não está definida.');
      }

      const body = {
        model: env.ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS_BY_EFFORT[env.AI_EFFORT] ?? 2048,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        // `tools` + `tool_choice` é como se obtém saída estruturada: a API
        // obriga o modelo a devolver um objecto conforme ao schema em vez
        // de texto livre que depois teríamos de desmontar à mão.
        tools: [
          {
            name: ANALYSIS_TOOL_NAME,
            description: 'Regista a análise estruturada da mensagem recebida.',
            input_schema: analysisJsonSchema,
          },
        ],
        tool_choice: { type: 'tool', name: ANALYSIS_TOOL_NAME },
      };

      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(`${env.ANTHROPIC_BASE_URL.replace(/\/$/, '')}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        // Rede em baixo ou tempo esgotado. Ambos passam com o tempo.
        throw new AiTransientError('Não foi possível contactar a Anthropic.', error);
      } finally {
        clearTimeout(timeout);
      }

      const latencyMs = Date.now() - startedAt;
      const text = await response.text();

      if (!response.ok) {
        // 429 e 5xx passam; 400 e 401 não passam sozinhos.
        const retryable = response.status === 429 || response.status >= 500;
        const detail = text.slice(0, 500);
        const message = `Anthropic devolveu ${response.status}: ${detail}`;

        logger.warn({ status: response.status, latencyMs }, 'Chamada à Anthropic falhou');

        throw retryable ? new AiTransientError(message) : new AiPermanentError(message);
      }

      let parsed: AnthropicResponse;
      try {
        parsed = JSON.parse(text) as AnthropicResponse;
      } catch (error) {
        throw new AiTransientError('A Anthropic devolveu algo que não é JSON.', error);
      }

      const toolUse = parsed.content?.find(
        (block) => block.type === 'tool_use' && block.name === ANALYSIS_TOOL_NAME,
      );

      if (!toolUse || toolUse.input === undefined) {
        // Acontece quando o modelo responde em texto apesar do tool_choice,
        // normalmente por ter sido interrompido a meio. Vale a pena repetir.
        throw new AiTransientError('A resposta da Anthropic não trouxe a análise estruturada.');
      }

      return {
        data: toolUse.input,
        model: parsed.model ?? env.ANTHROPIC_MODEL,
        tokensInput: parsed.usage?.input_tokens ?? null,
        tokensOutput: parsed.usage?.output_tokens ?? null,
        latencyMs,
      };
    },
  };
}

/**
 * O cliente em uso.
 *
 * Guardado numa variável para que os testes o possam substituir sem
 * mexer em variáveis de ambiente nem interceptar `fetch`.
 */
let client: AiClient | undefined;

export function getAiClient(): AiClient {
  client ??= createAnthropicClient();
  return client;
}

/** Apenas para testes: instala um cliente falso. */
export function setAiClient(fake: AiClient | undefined): void {
  client = fake;
}
