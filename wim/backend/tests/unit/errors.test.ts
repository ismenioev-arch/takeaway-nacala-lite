import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/middleware/errors.js';
import { durationToMs } from '../../src/app.js';

describe('AppError', () => {
  it('mapeia cada atalho para o código HTTP correcto', () => {
    expect(AppError.badRequest('x').statusCode).toBe(400);
    expect(AppError.unauthorized().statusCode).toBe(401);
    expect(AppError.forbidden().statusCode).toBe(403);
    expect(AppError.notFound().statusCode).toBe(404);
    expect(AppError.conflict('x').statusCode).toBe(409);
  });

  it('preserva mensagem e detalhes', () => {
    const error = AppError.badRequest('Telefone inválido', { field: 'phone' });

    expect(error.message).toBe('Telefone inválido');
    expect(error.details).toEqual({ field: 'phone' });
    expect(error.code).toBe('BAD_REQUEST');
    expect(error).toBeInstanceOf(Error);
  });

  it('tem mensagens por omissão em português', () => {
    expect(AppError.unauthorized().message).toBe('Não autenticado.');
    expect(AppError.forbidden().message).toBe('Sem permissão para esta operação.');
  });
});

describe('durationToMs', () => {
  it('converte cada unidade suportada', () => {
    expect(durationToMs('30s')).toBe(30_000);
    expect(durationToMs('15m')).toBe(900_000);
    expect(durationToMs('1h')).toBe(3_600_000);
    expect(durationToMs('30d')).toBe(2_592_000_000);
  });

  it('rejeita formatos inválidos', () => {
    for (const value of ['15', 'm', '15 m', '1.5h', '-5m', '']) {
      expect(() => durationToMs(value)).toThrow(/Duração inválida/);
    }
  });
});
