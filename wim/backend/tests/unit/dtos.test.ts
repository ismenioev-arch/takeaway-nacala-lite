/**
 * Os DTOs são o contrato com o painel. Estes testes fixam as decisões que,
 * se mudassem sem se notar, davam informação errada ao utilizador.
 */
import { describe, expect, it } from 'vitest';
import { buildPagination } from '../../src/dtos/common.dto.js';
import { resolveContactName } from '../../src/dtos/contact.dto.js';
import { isAwaitingReply } from '../../src/dtos/conversation.dto.js';
import { resolveSortDirection } from '../../src/services/conversations.service.js';
import { buildExcerpt } from '../../src/services/search.service.js';
import { diffValues } from '../../src/services/audit.service.js';

describe('buildPagination', () => {
  it('calcula as páginas', () => {
    expect(buildPagination(1, 25, 100)).toEqual({
      page: 1,
      pageSize: 25,
      total: 100,
      totalPages: 4,
      hasNext: true,
      hasPrevious: false,
    });
  });

  it('arredonda para cima a última página incompleta', () => {
    expect(buildPagination(1, 25, 101).totalPages).toBe(5);
  });

  it('lida com zero resultados sem dividir por zero', () => {
    expect(buildPagination(1, 25, 0)).toMatchObject({
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    });
  });

  it('marca a última página sem próxima', () => {
    expect(buildPagination(4, 25, 100)).toMatchObject({
      hasNext: false,
      hasPrevious: true,
    });
  });
});

describe('resolveContactName', () => {
  it('prefere o nome definido no painel', () => {
    expect(
      resolveContactName({
        display_name: 'João Macuácua',
        profile_name: 'Joao',
        phone_e164: '+258840001234',
      }),
    ).toBe('João Macuácua');
  });

  it('usa o nome do perfil quando não há nome definido', () => {
    expect(
      resolveContactName({
        display_name: null,
        profile_name: 'Joao',
        phone_e164: '+258840001234',
      }),
    ).toBe('Joao');
  });

  it('usa o telefone em último caso, nunca deixa vazio', () => {
    expect(
      resolveContactName({ display_name: null, profile_name: null, phone_e164: '+258840001234' }),
    ).toBe('+258840001234');
  });

  it('trata nomes só com espaços como ausentes', () => {
    expect(
      resolveContactName({
        display_name: '   ',
        profile_name: '  ',
        phone_e164: '+258840001234',
      }),
    ).toBe('+258840001234');
  });
});

describe('isAwaitingReply', () => {
  const antes = new Date('2026-08-13T08:00:00Z');
  const depois = new Date('2026-08-13T09:00:00Z');

  it('está à espera quando o cliente falou por último', () => {
    expect(isAwaitingReply({ last_inbound_at: depois, last_outbound_at: antes })).toBe(true);
  });

  it('não está à espera quando já respondemos depois', () => {
    expect(isAwaitingReply({ last_inbound_at: antes, last_outbound_at: depois })).toBe(false);
  });

  it('está à espera quando nunca respondemos', () => {
    expect(isAwaitingReply({ last_inbound_at: antes, last_outbound_at: null })).toBe(true);
  });

  it('não está à espera quando nunca recebeu nada', () => {
    expect(isAwaitingReply({ last_inbound_at: null, last_outbound_at: null })).toBe(false);
  });
});

describe('resolveSortDirection', () => {
  it('respeita o sentido pedido', () => {
    expect(resolveSortDirection('priority', 'desc')).toBe('desc');
    expect(resolveSortDirection('lastMessageAt', 'asc')).toBe('asc');
  });

  it('por prioridade, "primeiro" significa "mais urgente"', () => {
    // No PostgreSQL isso é ASC, porque o enum foi declarado com URGENTE
    // à cabeça. "desc" poria as normais no topo, que é o contrário do que
    // qualquer pessoa espera do painel.
    expect(resolveSortDirection('priority', undefined)).toBe('asc');
  });

  it('por data, "primeiro" significa "mais recente"', () => {
    expect(resolveSortDirection('lastMessageAt', undefined)).toBe('desc');
    expect(resolveSortDirection('createdAt', undefined)).toBe('desc');
  });
});

describe('buildExcerpt', () => {
  const texto =
    'Bom dia. Escrevo para informar que a fundação da obra do lote 12 vai começar ' +
    'amanhã de manhã e precisamos de confirmar a alteração da planta antes disso.';

  it('recorta à volta da ocorrência', () => {
    const excerto = buildExcerpt(texto, 'fundação', 20);

    expect(excerto).toContain('fundação');
    expect(excerto.length).toBeLessThan(texto.length);
    expect(excerto.startsWith('…')).toBe(true);
  });

  it('não põe reticências quando a ocorrência está no início', () => {
    expect(buildExcerpt('fundação da obra', 'fundação', 20).startsWith('…')).toBe(false);
  });

  it('ignora maiúsculas e minúsculas', () => {
    expect(buildExcerpt(texto, 'FUNDAÇÃO', 20)).toContain('fundação');
  });

  it('devolve string vazia quando não há texto', () => {
    expect(buildExcerpt(null, 'fundação')).toBe('');
  });

  it('devolve o início quando o termo não aparece', () => {
    expect(buildExcerpt('texto curto', 'inexistente')).toBe('texto curto');
  });
});

describe('diffValues', () => {
  it('devolve apenas os campos que mudaram', () => {
    const before = { status: 'OPEN', priority: 'NORMAL', subject: 'Obra' };
    const after = { status: 'OPEN', priority: 'URGENTE', subject: 'Obra' };

    const result = diffValues(before, after, ['status', 'priority', 'subject']);

    expect(result.changed).toBe(true);
    expect(result.oldValue).toEqual({ priority: 'NORMAL' });
    expect(result.newValue).toEqual({ priority: 'URGENTE' });
  });

  it('indica que nada mudou', () => {
    const row = { status: 'OPEN', priority: 'NORMAL' };
    const result = diffValues(row, { ...row }, ['status', 'priority']);

    expect(result.changed).toBe(false);
    expect(result.oldValue).toEqual({});
  });

  it('só olha para os campos indicados', () => {
    const before = { a: 1, b: 1 };
    const after = { a: 2, b: 2 };

    const result = diffValues(before, after, ['a']);
    expect(result.newValue).toEqual({ a: 2 });
  });
});
