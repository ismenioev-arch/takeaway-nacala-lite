/**
 * O worker da fila, para quando o WIM corre num servidor permanente.
 *
 * Em serverless isto não existe — não há processo entre pedidos, e a fila é
 * empurrada por um agendador que chama `POST /api/ai/analyze`. Num
 * contentor ou numa máquina, haver um ciclo interno poupa a dependência de
 * um agendador externo e faz as mensagens serem analisadas segundos depois
 * de chegarem.
 *
 * O ciclo usa `setTimeout` encadeado e não `setInterval`, de propósito: se
 * um lote demorar mais do que o intervalo, o seguinte espera pelo fim em
 * vez de se sobrepor. Sobrepor não partiria nada — a reivindicação das
 * mensagens é atómica — mas multiplicaria chamadas à Claude sem necessidade.
 */
import { getEnv, isAiEnabled, isServerless } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { runAnalysisBatch } from '../analysis.service.js';

let timer: NodeJS.Timeout | undefined;
let stopped = false;

async function tick(intervalMs: number): Promise<void> {
  if (stopped) return;

  try {
    const result = await runAnalysisBatch();

    if (result.analyzed > 0 || result.failed > 0) {
      logger.info(
        { analyzed: result.analyzed, failed: result.failed, remaining: result.remaining },
        'Lote de análise processado',
      );
    }

    // Ainda há fila? Volta já, em vez de deixar mensagens à espera do
    // próximo intervalo só porque o lote tem tecto.
    if (result.remaining > 0 && result.retried === 0) {
      schedule(intervalMs, 100);
      return;
    }
  } catch (error) {
    // O worker nunca morre por causa de um erro: isso deixaria a fila
    // parada em silêncio até alguém reiniciar o servidor.
    logger.error({ err: error }, 'Falha inesperada no worker de análise');
  }

  schedule(intervalMs, intervalMs);
}

function schedule(intervalMs: number, delay: number): void {
  if (stopped) return;

  timer = setTimeout(() => void tick(intervalMs), delay);
  // Não impede o processo de terminar enquanto espera.
  timer.unref?.();
}

/** Arranca o worker, se fizer sentido neste ambiente. Devolve se arrancou. */
export function startAnalysisWorker(): boolean {
  const env = getEnv();

  if (!env.AI_WORKER_ENABLED) return false;
  if (!isAiEnabled(env)) return false;

  if (isServerless(env)) {
    logger.warn(
      'AI_WORKER_ENABLED=true ignorado: em serverless não há processo entre pedidos. ' +
        'Use um agendador a chamar POST /api/ai/analyze.',
    );
    return false;
  }

  stopped = false;
  schedule(env.AI_WORKER_INTERVAL_MS, env.AI_WORKER_INTERVAL_MS);
  logger.info({ intervalMs: env.AI_WORKER_INTERVAL_MS }, 'Worker de análise iniciado');

  return true;
}

export function stopAnalysisWorker(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = undefined;
}
