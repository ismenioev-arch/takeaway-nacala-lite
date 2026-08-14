/**
 * A construção de SQL é onde uma injecção entraria. Estes testes fixam o
 * contrato: os valores nunca aparecem na string da consulta.
 */
import { describe, expect, it } from 'vitest';
import { Conditions, likePattern, resolveOrderBy } from '../../src/repositories/query-builder.js';

describe('Conditions', () => {
  it('não produz WHERE quando não há condições', () => {
    const conditions = new Conditions();

    expect(conditions.isEmpty).toBe(true);
    expect(conditions.toWhere()).toBe('');
    expect(conditions.toValues()).toEqual([]);
  });

  it('numera os marcadores por ordem', () => {
    const conditions = new Conditions()
      .add('a = ?', 1)
      .add('b = ?', 2)
      .add('c BETWEEN ? AND ?', 3, 4);

    expect(conditions.toWhere()).toBe('WHERE a = $1 AND b = $2 AND c BETWEEN $3 AND $4');
    expect(conditions.toValues()).toEqual([1, 2, 3, 4]);
  });

  it('nunca coloca o valor dentro da string da consulta', () => {
    const malicioso = "'; DROP TABLE messages; --";
    const conditions = new Conditions().add('body = ?', malicioso);

    expect(conditions.toWhere()).toBe('WHERE body = $1');
    expect(conditions.toWhere()).not.toContain('DROP');
    expect(conditions.toValues()).toEqual([malicioso]);
  });

  it('recusa um número de valores diferente do de marcadores', () => {
    // Um desencontro daria uma consulta com parâmetros trocados — pior do que
    // falhar, porque devolveria dados errados em silêncio.
    expect(() => new Conditions().add('a = ? AND b = ?', 1)).toThrow(/2 marcador/);
    expect(() => new Conditions().add('a = ?', 1, 2)).toThrow(/2 valor/);
  });

  it('ignora condições sem valor', () => {
    const conditions = new Conditions()
      .addIfDefined('a = ?', undefined)
      .addIfDefined('b = ?', null)
      .addIfDefined('c = ?', 0);

    // Zero é um valor legítimo e tem de passar.
    expect(conditions.toWhere()).toBe('WHERE c = $1');
    expect(conditions.toValues()).toEqual([0]);
  });

  it('ignora listas vazias', () => {
    const conditions = new Conditions()
      .addIfNotEmpty('a = ANY(?)', [])
      .addIfNotEmpty('b = ANY(?)', undefined)
      .addIfNotEmpty('c = ANY(?)', ['x']);

    expect(conditions.toWhere()).toBe('WHERE c = ANY($1)');
  });

  it('indica o próximo índice para LIMIT e OFFSET', () => {
    const conditions = new Conditions().add('a = ?', 1).add('b = ?', 2);
    expect(conditions.nextIndex).toBe(3);
  });
});

describe('likePattern', () => {
  it('envolve o termo em curingas', () => {
    expect(likePattern('joão')).toBe('%joão%');
  });

  it('escapa o sinal de percentagem', () => {
    // Sem isto, pesquisar "50%" devolveria a base de dados inteira.
    expect(likePattern('50%')).toBe('%50\\%%');
  });

  it('escapa o traço inferior', () => {
    // Sem isto, "a_b" encontraria "axb".
    expect(likePattern('a_b')).toBe('%a\\_b%');
  });

  it('escapa a própria barra de escape', () => {
    expect(likePattern('a\\b')).toBe('%a\\\\b%');
  });

  it('deixa texto normal intacto', () => {
    expect(likePattern("Obra parada, é urgente!")).toBe("%Obra parada, é urgente!%");
  });
});

describe('resolveOrderBy', () => {
  const allowed = { name: 'display_name', date: 'created_at' } as const;

  it('traduz o campo da API para a coluna', () => {
    expect(resolveOrderBy(allowed, 'name', 'asc')).toBe('display_name ASC');
    expect(resolveOrderBy(allowed, 'date', 'desc')).toBe('created_at DESC');
  });

  it('recusa uma coluna fora da lista', () => {
    // A ordenação faz parte da estrutura da consulta e não pode ser
    // parametrizada — por isso o nome tem de vir de uma lista fechada.
    expect(() =>
      resolveOrderBy(allowed, 'password_hash' as keyof typeof allowed, 'asc'),
    ).toThrow(/não permitida/);
  });
});
