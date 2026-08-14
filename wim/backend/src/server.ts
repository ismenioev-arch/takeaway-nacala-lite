/**
 * Arranque do servidor.
 *
 * Sequência deliberada:
 *   1. validar a configuração  → falha cedo, com mensagem clara
 *   2. verificar a base de dados → não arrancar "meio vivo"
 *   3. abrir a porta
 *   4. instalar o encerramento gracioso
 */
import { EnvValidationError, getEnv } from './config/env.js';
import { buildApp } from './app.js';
import { checkDatabaseHealth, closePool } from './database/pool.js';

async function main(): Promise<void> {
  const env = getEnv();

  const health = await checkDatabaseHealth();
  if (!health.connected) {
    throw new Error(
      `Não foi possível ligar à base de dados: ${health.error ?? 'motivo desconhecido'}\n` +
        'Verifique DATABASE_URL e se o PostgreSQL está a correr.',
    );
  }

  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });

  app.log.info(
    { port: env.PORT, database: health.serverVersion, latencyMs: health.latencyMs },
    'WIM backend pronto',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info({ signal }, 'a encerrar');
    try {
      await app.close();
      await closePool();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'falha ao encerrar');
      process.exit(1);
    }
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof EnvValidationError) {
    // Mensagem de configuração: já é legível, não precisa de stack trace.
    console.error(`\n${error.message}\n`);
  } else {
    console.error('\nO servidor não conseguiu arrancar:\n');
    console.error(error instanceof Error ? error.message : String(error));
    console.error('');
  }
  await closePool().catch(() => undefined);
  process.exit(1);
}
