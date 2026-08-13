/**
 * Comando de migrações.
 *
 *   npm run migrate          → aplica as migrações pendentes
 *   npm run migrate:status   → mostra o estado, sem alterar nada
 */
import { closePool } from './pool.js';
import { getMigrationStatus, migrateUp } from './migrator.js';

async function commandUp(): Promise<void> {
  const result = await migrateUp();

  if (result.applied.length === 0) {
    console.log(`Nada a fazer — ${result.alreadyApplied} migração(ões) já aplicada(s).`);
    return;
  }

  console.log(`Aplicadas ${result.applied.length} migração(ões):`);
  for (const name of result.applied) console.log(`  ✔ ${name}`);
}

async function commandStatus(): Promise<void> {
  const status = await getMigrationStatus();

  console.log(`Aplicadas (${status.applied.length}):`);
  for (const m of status.applied) {
    console.log(`  ✔ ${m.name}  —  ${m.appliedAt.toISOString()}`);
  }

  console.log(`\nPendentes (${status.pending.length}):`);
  for (const m of status.pending) console.log(`  · ${m.name}`);

  if (status.changed.length > 0) {
    console.log(`\n⚠ Alteradas depois de aplicadas (${status.changed.length}):`);
    for (const name of status.changed) console.log(`  ! ${name}`);
  }
}

const command = process.argv[2] ?? 'up';

try {
  if (command === 'up') {
    await commandUp();
  } else if (command === 'status') {
    await commandStatus();
  } else {
    console.error(`Comando desconhecido: "${command}". Use "up" ou "status".`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await closePool();
}
