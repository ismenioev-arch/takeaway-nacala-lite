/**
 * `npm run setup:env`
 *
 * Cria o ficheiro `.env` a partir do `.env.example` e preenche os segredos
 * que o sistema precisa para arrancar.
 *
 * Existe porque a alternativa era pedir ao dono do sistema que corresse
 * `openssl rand -base64 48` duas vezes e colasse os resultados nos sítios
 * certos — um passo fácil de errar e sem valor nenhum para ele.
 *
 * Nunca sobrepõe um `.env` existente: um segredo substituído por engano
 * derrubaria todas as sessões abertas.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, '..', '..');

const EXAMPLE_PATH = join(backendRoot, '.env.example');
const ENV_PATH = join(backendRoot, '.env');

/** Variáveis preenchidas automaticamente com um valor aleatório. */
const GENERATED_SECRETS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

const generateSecret = (): string => randomBytes(48).toString('base64');

export function fillSecrets(template: string, keys: readonly string[]): string {
  return template
    .split('\n')
    .map((line) => {
      const match = /^([A-Z_]+)=(.*)$/.exec(line);
      if (!match) return line;

      const [, key, currentValue] = match;

      // Só preenche o que está vazio: um valor já escrito é intencional.
      if (!key || !keys.includes(key) || currentValue?.trim() !== '') return line;

      return `${key}=${generateSecret()}`;
    })
    .join('\n');
}

async function main(): Promise<void> {
  if (existsSync(ENV_PATH)) {
    console.log('O ficheiro .env já existe — nada foi alterado.');
    console.log('Se quiser recomeçar, apague-o primeiro (perderá as sessões abertas).');
    return;
  }

  if (!existsSync(EXAMPLE_PATH)) {
    throw new Error(`Não encontrei o ficheiro ${EXAMPLE_PATH}`);
  }

  const template = await readFile(EXAMPLE_PATH, 'utf8');
  await writeFile(ENV_PATH, fillSecrets(template, GENERATED_SECRETS), { mode: 0o600 });

  console.log('Ficheiro .env criado, com os segredos de sessão já gerados.');
  console.log('');
  console.log('Falta indicar a ligação à base de dados, se não for a predefinida:');
  console.log('  DATABASE_URL=postgresql://wim:wim_dev_password@localhost:5432/wim');
  console.log('');
  console.log('Depois:  npm run migrate  &&  npm run create-user');
}

/**
 * Só corre quando este ficheiro é o programa invocado.
 *
 * Sem esta guarda, importar `fillSecrets` noutro sítio — um teste, por
 * exemplo — escreveria o ficheiro `.env` como efeito secundário do import.
 */
const isEntryPoint = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
