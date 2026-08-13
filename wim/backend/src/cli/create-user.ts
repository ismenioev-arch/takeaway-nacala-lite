/**
 * `npm run create-user`
 *
 * Cria um utilizador do painel. É a única forma de criar o primeiro — não há
 * registo aberto, porque o WIM é um painel interno e não um serviço público.
 *
 * Num terminal, a password é pedida com o eco desligado: não fica no
 * histórico da shell nem visível por cima do ombro.
 */
import { createInterface, type Interface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { closePool } from '../database/pool.js';
import { countUsers } from '../repositories/users.repository.js';
import { createUser } from '../services/auth.service.js';
import { createUserSchema } from '../validators/auth.validators.js';
import { USER_ROLES, type UserRole } from '../models/enums.js';

/**
 * Uma única interface de leitura para toda a sessão.
 *
 * Criar uma por pergunta parece inofensivo mas parte o programa quando a
 * entrada vem canalizada (`printf ... | npm run create-user`): a primeira
 * interface consome o fluxo inteiro e as seguintes ficam à espera de dados
 * que já não chegam.
 */
class Prompt {
  private readonly rl: Interface | undefined;
  private readonly isTerminal: boolean;
  /** Respostas pré-lidas, quando a entrada vem canalizada. */
  private readonly buffered: string[] = [];
  private hiding = false;

  constructor() {
    this.isTerminal = Boolean(stdin.isTTY);

    if (!this.isTerminal) {
      // Sem terminal, o fluxo pode terminar antes de chegarmos às perguntas.
      // Ler tudo de uma vez torna o comportamento determinístico e permite
      // usar o comando em scripts.
      return;
    }

    this.rl = createInterface({ input: stdin, output: stdout, terminal: true });

    const internals = this.rl as unknown as { _writeToOutput: (text: string) => void };
    const original = internals._writeToOutput.bind(this.rl);

    internals._writeToOutput = (text: string) => {
      // Enquanto se escreve a password, só a pergunta aparece no ecrã.
      original(this.hiding ? '' : text);
    };
  }

  /** Lê a entrada canalizada. Chamado uma vez, antes da primeira pergunta. */
  async prepare(): Promise<void> {
    if (this.isTerminal) return;

    const chunks: Buffer[] = [];
    for await (const chunk of stdin) {
      chunks.push(Buffer.from(chunk as Buffer));
    }

    this.buffered.push(...Buffer.concat(chunks).toString('utf8').split('\n'));
  }

  async ask(question: string): Promise<string> {
    if (!this.rl) {
      const answer = this.buffered.shift();

      if (answer === undefined) {
        throw new Error(`Faltou a resposta a "${question.trim()}".`);
      }

      return answer.trim();
    }

    return (await this.rl.question(question)).trim();
  }

  /** Como `ask`, mas sem mostrar o que é escrito. */
  async askSecret(question: string): Promise<string> {
    if (!this.rl) {
      // Sem terminal não há eco para esconder.
      return this.ask(question);
    }

    stdout.write(question);
    this.hiding = true;

    try {
      const answer = await this.rl.question('');
      stdout.write('\n');
      return answer.trim();
    } finally {
      this.hiding = false;
    }
  }

  close(): void {
    this.rl?.close();
  }
}

async function main(prompt: Prompt): Promise<void> {
  const existing = await countUsers();

  if (existing === 0) {
    console.log('Ainda não existe nenhum utilizador.');
    console.log('Este primeiro será o proprietário do sistema (papel OWNER).\n');
  }

  const email = await prompt.ask('E-mail: ');
  const name = await prompt.ask('Nome: ');

  const defaultRole: UserRole = existing === 0 ? 'OWNER' : 'AGENT';
  const roleAnswer =
    existing === 0
      ? defaultRole
      : (await prompt.ask(`Papel [${USER_ROLES.join(' | ')}] (${defaultRole}): `)) ||
        defaultRole;

  const password = await prompt.askSecret('Password (mínimo 12 caracteres): ');
  const confirmation = await prompt.askSecret('Repita a password: ');

  if (password !== confirmation) {
    throw new Error('As passwords não coincidem.');
  }

  // Valida com as mesmas regras da API — o CLI não é uma porta das traseiras.
  const input = createUserSchema.parse({ email, name, role: roleAnswer, password });

  const user = await createUser(input);

  console.log('');
  console.log(`Utilizador criado: ${user.name} <${user.email}> — papel ${user.role}`);
  console.log('Já pode entrar no painel.');
}

const prompt = new Prompt();

try {
  await prompt.prepare();
  await main(prompt);
} catch (error) {
  console.error('');

  if (error && typeof error === 'object' && 'issues' in error) {
    // Erro de validação do Zod: mostrar campo a campo.
    const issues = (error as { issues: Array<{ path: unknown[]; message: string }> }).issues;
    for (const issue of issues) {
      console.error(`  • ${issue.path.join('.') || 'valor'}: ${issue.message}`);
    }
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }

  process.exitCode = 1;
} finally {
  prompt.close();
  await closePool();
}
