/**
 * Construção segura de condições SQL.
 *
 * Os filtros do painel (secção 12) são muitos e combináveis, o que leva
 * facilmente a construir SQL por concatenação de texto — e daí a uma injecção
 * de SQL é um passo.
 *
 * Aqui os valores NUNCA entram na string. Escreve-se a condição com `?` e o
 * construtor troca cada `?` pelo `$n` correspondente, guardando o valor à
 * parte para o driver enviar em separado.
 */

export class Conditions {
  private readonly clauses: string[] = [];
  private readonly values: unknown[] = [];

  /**
   * Acrescenta uma condição. Use `?` para cada valor.
   *
   *   conditions.add('c.category = ?', 'CLIENTE');
   *   conditions.add('c.status = ANY(?)', ['NEW', 'OPEN']);
   */
  add(fragment: string, ...values: unknown[]): this {
    const expected = (fragment.match(/\?/g) ?? []).length;

    if (expected !== values.length) {
      throw new Error(
        `Condição inválida: "${fragment}" tem ${expected} marcador(es) ` +
          `mas recebeu ${values.length} valor(es).`,
      );
    }

    let index = this.values.length;
    const numbered = fragment.replace(/\?/g, () => {
      index += 1;
      return `$${index}`;
    });

    this.clauses.push(numbered);
    this.values.push(...values);
    return this;
  }

  /** Acrescenta a condição apenas quando o valor está definido. */
  addIfDefined(fragment: string, value: unknown): this {
    if (value === undefined || value === null) return this;
    return this.add(fragment, value);
  }

  /** Acrescenta a condição apenas quando a lista tem elementos. */
  addIfNotEmpty(fragment: string, values: readonly unknown[] | undefined): this {
    if (!values || values.length === 0) return this;
    return this.add(fragment, values);
  }

  get isEmpty(): boolean {
    return this.clauses.length === 0;
  }

  /** `WHERE a AND b`, ou string vazia quando não há condições. */
  toWhere(): string {
    return this.isEmpty ? '' : `WHERE ${this.clauses.join(' AND ')}`;
  }

  /** Os valores, pela ordem dos `$n`. */
  toValues(): unknown[] {
    return [...this.values];
  }

  /**
   * Devolve o próximo número de parâmetro disponível.
   * Útil para acrescentar LIMIT/OFFSET depois das condições.
   */
  get nextIndex(): number {
    return this.values.length + 1;
  }
}

/**
 * Transforma texto do utilizador num padrão de pesquisa parcial.
 *
 * Parametrizar o valor impede injecção de SQL, mas não chega: dentro de um
 * `LIKE`, os caracteres `%` e `_` continuam a ser curingas. Sem os escapar,
 * quem pesquisasse «50%» receberia a base de dados inteira, e quem
 * pesquisasse «a_b» encontraria «axb».
 *
 * O `\` também é escapado, senão o próprio escape podia ser anulado.
 */
export function likePattern(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}

/**
 * Colunas por que é permitido ordenar, por recurso.
 *
 * A ordenação não pode ser parametrizada como valor (faz parte da estrutura da
 * consulta), por isso o nome da coluna tem de vir de uma lista fechada. Nunca
 * de texto enviado pelo cliente.
 */
export function resolveOrderBy<T extends string>(
  allowed: Readonly<Record<T, string>>,
  field: T,
  direction: 'asc' | 'desc',
): string {
  const column = allowed[field];

  if (!column) {
    throw new Error(`Coluna de ordenação não permitida: "${String(field)}"`);
  }

  return `${column} ${direction === 'asc' ? 'ASC' : 'DESC'}`;
}
