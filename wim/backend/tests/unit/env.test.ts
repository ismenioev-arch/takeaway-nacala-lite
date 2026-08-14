/**
 * A configuração é a primeira linha de defesa: se o servidor arrancar com
 * variáveis em falta, o erro aparece mais tarde e no sítio errado.
 * Estes testes garantem que ele recusa arrancar, e diz porquê.
 */
import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../../src/config/env.js';

// A partir da FASE 4 os segredos de sessão são obrigatórios em qualquer
// ambiente: sem eles não é possível emitir nem verificar sessões.
const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/wim',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
};

const productionEnv = {
  ...validEnv,
  NODE_ENV: 'production',
  WHATSAPP_APP_SECRET: 'c'.repeat(20),
  WHATSAPP_VERIFY_TOKEN: 'd'.repeat(20),
  WHATSAPP_ACCESS_TOKEN: 'EAAG...token',
  WHATSAPP_PHONE_NUMBER_ID: '123456789',
  ANTHROPIC_API_KEY: 'sk-ant-xxx',
};

describe('parseEnv', () => {
  it('aceita a configuração mínima de desenvolvimento', () => {
    const env = parseEnv(validEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
  });

  it('aplica os valores por omissão documentados', () => {
    const env = parseEnv(validEnv);

    expect(env.PORT).toBe(3001);
    expect(env.ANTHROPIC_MODEL).toBe('claude-opus-5');
    expect(env.AI_CONFIDENCE_THRESHOLD).toBe(0.9);
    expect(env.WHATSAPP_API_VERSION).toBe('v21.0');
    expect(env.DATABASE_SSL).toBe(false);
  });

  it('recusa arrancar sem DATABASE_URL, e diz qual falta', () => {
    const semBaseDeDados = { ...validEnv, DATABASE_URL: undefined };

    expect(() => parseEnv(semBaseDeDados)).toThrow(EnvValidationError);

    try {
      parseEnv(semBaseDeDados);
      expect.unreachable('devia ter lançado');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues.join('\n')).toContain('DATABASE_URL');
      expect((error as EnvValidationError).message).toContain('.env.example');
    }
  });

  it('converte PORT para número e rejeita valores impossíveis', () => {
    expect(parseEnv({ ...validEnv, PORT: '8080' }).PORT).toBe(8080);
    expect(() => parseEnv({ ...validEnv, PORT: '70000' })).toThrow(EnvValidationError);
    expect(() => parseEnv({ ...validEnv, PORT: 'abc' })).toThrow(EnvValidationError);
  });

  it('rejeita durações mal formadas', () => {
    expect(() => parseEnv({ ...validEnv, JWT_ACCESS_TTL: '15 minutos' })).toThrow(
      EnvValidationError,
    );
    expect(parseEnv({ ...validEnv, JWT_ACCESS_TTL: '45m' }).JWT_ACCESS_TTL).toBe('45m');
  });

  it('rejeita uma versão da API da Meta com formato inválido', () => {
    expect(() => parseEnv({ ...validEnv, WHATSAPP_API_VERSION: '21' })).toThrow(
      EnvValidationError,
    );
    expect(parseEnv({ ...validEnv, WHATSAPP_API_VERSION: 'v22.0' }).WHATSAPP_API_VERSION).toBe(
      'v22.0',
    );
  });

  it('rejeita um limiar de confiança fora do intervalo 0–1', () => {
    expect(() => parseEnv({ ...validEnv, AI_CONFIDENCE_THRESHOLD: '1.5' })).toThrow(
      EnvValidationError,
    );
  });

  describe('em produção', () => {
    it('aceita a configuração completa', () => {
      const env = parseEnv(productionEnv);
      expect(env.NODE_ENV).toBe('production');
    });

    it('exige todos os segredos, e lista os que faltam', () => {
      try {
        parseEnv({ ...validEnv, NODE_ENV: 'production' });
        expect.unreachable('devia ter lançado');
      } catch (error) {
        const issues = (error as EnvValidationError).issues.join('\n');

        expect(issues).toContain('WHATSAPP_APP_SECRET');
        expect(issues).toContain('WHATSAPP_VERIFY_TOKEN');
        expect(issues).toContain('WHATSAPP_ACCESS_TOKEN');
        expect(issues).toContain('ANTHROPIC_API_KEY');
      }
    });

    it('recusa um segredo demasiado curto', () => {
      expect(() =>
        parseEnv({ ...productionEnv, JWT_ACCESS_SECRET: 'curto' }),
      ).toThrow(EnvValidationError);
    });

    it('recusa reutilizar o mesmo segredo em access e refresh', () => {
      const sameSecret = 'z'.repeat(40);

      expect(() =>
        parseEnv({
          ...productionEnv,
          JWT_ACCESS_SECRET: sameSecret,
          JWT_REFRESH_SECRET: sameSecret,
        }),
      ).toThrow(/não pode ser igual/);
    });
  });

  it('em desenvolvimento não exige os segredos das fases seguintes', () => {
    const env = parseEnv(validEnv);

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.WHATSAPP_APP_SECRET).toBeUndefined();
  });

  describe('variáveis vazias', () => {
    // O .env.example traz as chaves das fases seguintes sem valor. O dotenv
    // lê-as como '' e não como ausentes — sem tratamento, o servidor recusava
    // arrancar em desenvolvimento por causa de variáveis ainda não precisas.
    it('trata uma variável vazia como não definida', () => {
      const env = parseEnv({
        ...validEnv,
        ANTHROPIC_API_KEY: '',
        WHATSAPP_APP_SECRET: '',
        WHATSAPP_ACCESS_TOKEN: '   ',
      });

      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.WHATSAPP_APP_SECRET).toBeUndefined();
      expect(env.WHATSAPP_ACCESS_TOKEN).toBeUndefined();
    });

    it('aplica o valor por omissão quando a variável está vazia', () => {
      expect(parseEnv({ ...validEnv, PORT: '' }).PORT).toBe(3001);
      expect(parseEnv({ ...validEnv, ANTHROPIC_MODEL: '' }).ANTHROPIC_MODEL).toBe('claude-opus-5');
    });

    it('continua a recusar uma variável obrigatória vazia', () => {
      expect(() => parseEnv({ ...validEnv, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
    });

    it('recusa arrancar sem os segredos de sessão', () => {
      // Sem eles não há autenticação possível — por isso são obrigatórios
      // em qualquer ambiente, e não apenas em produção.
      expect(() =>
        parseEnv({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/wim' }),
      ).toThrow(/JWT_ACCESS_SECRET/);
    });

    it('a mensagem de erro diz como gerar um segredo', () => {
      try {
        parseEnv({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/wim' });
        expect.unreachable('devia ter lançado');
      } catch (error) {
        expect((error as EnvValidationError).message).toContain('openssl rand');
        expect((error as EnvValidationError).message).toContain('npm run setup:env');
      }
    });

    it('em produção, um segredo vazio conta como em falta', () => {
      expect(() =>
        parseEnv({ ...productionEnv, WHATSAPP_APP_SECRET: '' }),
      ).toThrow(/obrigatória quando NODE_ENV=production/);
    });
  });
});
