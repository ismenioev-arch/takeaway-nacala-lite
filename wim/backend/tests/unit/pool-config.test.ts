/**
 * Duas decisões do pool que só se manifestam em produção — e que, quando
 * estão erradas, custam horas a diagnosticar:
 *
 *   • SSL: o erro aparece como «the server does not support SSL connections»
 *     ou o seu inverso, nenhum dos dois a apontar para a verdadeira causa.
 *   • Tamanho do pool: em serverless não falha logo; falha quando há tráfego,
 *     com «too many connections for role».
 *
 * Por isso são funções puras e testadas, em vez de uma expressão escondida
 * dentro da criação do pool.
 */
import { describe, expect, it } from 'vitest';
import { resolvePoolMax, shouldUseSsl } from '../../src/database/pool.js';

describe('shouldUseSsl', () => {
  const local = 'postgresql://wim:wim@localhost:5432/wim';
  const neon =
    'postgresql://u:p@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/wim?sslmode=require';

  it('não usa SSL num PostgreSQL local', () => {
    expect(shouldUseSsl(local, false)).toBe(false);
  });

  it('usa SSL quando o URL o exige, sem precisar de DATABASE_SSL', () => {
    expect(shouldUseSsl(neon, false)).toBe(true);
  });

  it('reconhece os restantes modos que implicam ligação cifrada', () => {
    expect(shouldUseSsl(`${local}?sslmode=verify-full`, false)).toBe(true);
    expect(shouldUseSsl(`${local}?sslmode=verify-ca`, false)).toBe(true);
  });

  it('ignora sslmode=disable e sslmode=prefer', () => {
    expect(shouldUseSsl(`${local}?sslmode=disable`, false)).toBe(false);
    expect(shouldUseSsl(`${local}?sslmode=prefer`, false)).toBe(false);
  });

  it('encontra o parâmetro mesmo quando não é o primeiro', () => {
    expect(shouldUseSsl(`${neon}&channel_binding=require`, false)).toBe(true);
    expect(shouldUseSsl(`${local}?application_name=wim&sslmode=require`, false)).toBe(true);
  });

  it('DATABASE_SSL=true continua a mandar, para URLs que nada declaram', () => {
    expect(shouldUseSsl(local, true)).toBe(true);
  });
});

describe('resolvePoolMax', () => {
  it('num servidor permanente respeita o valor configurado', () => {
    expect(resolvePoolMax(10, false)).toBe(10);
  });

  // Dez invocações simultâneas são dez processos. Com 10 ligações cada,
  // seriam 100 ligações abertas contra a base de dados — muito acima do que
  // um plano Neon gratuito aceita.
  it('em serverless limita o pool, por mais alto que esteja configurado', () => {
    expect(resolvePoolMax(10, true)).toBe(2);
    expect(resolvePoolMax(50, true)).toBe(2);
  });

  it('não sobe um valor deliberadamente baixo', () => {
    expect(resolvePoolMax(1, true)).toBe(1);
  });
});
