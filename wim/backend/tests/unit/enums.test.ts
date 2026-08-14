/**
 * Os tipos enumerados são o vocabulário partilhado entre a base de dados, a
 * API e o schema que a IA tem de devolver. Se divergirem, o sistema aceita
 * dados que não consegue guardar.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_LEVELS,
  CLOSED_CONVERSATION_STATUSES,
  CONTACT_CATEGORIES,
  CONVERSATION_STATUSES,
  comparePriority,
  DRAFT_STATUSES,
  highestPriority,
  INTENTS,
  MEDIA_MESSAGE_TYPES,
  MESSAGE_STATUSES,
  PRIORITIES,
} from '../../src/models/enums.js';

describe('valores da especificação', () => {
  it('tem as 4 prioridades da secção 4, da mais grave para a menos grave', () => {
    expect(PRIORITIES).toEqual(['URGENTE', 'IMPORTANTE', 'ACOMPANHAR', 'NORMAL']);
  });

  it('tem as 15 intenções da secção 5', () => {
    expect(INTENTS).toHaveLength(15);
    expect(INTENTS).toContain('ALTERACAO_PROJETO');
    expect(INTENTS).toContain('RECLAMACAO');
    expect(INTENTS).toContain('OUTRO');
  });

  it('tem os 7 estados da conversa da secção 22', () => {
    expect(CONVERSATION_STATUSES).toHaveLength(7);
    expect(CONVERSATION_STATUSES).toContain('WAITING_HUMAN');
    expect(CONVERSATION_STATUSES).toContain('FOLLOW_UP');
  });

  it('tem os estados da mensagem da secção 23', () => {
    for (const status of ['RECEIVED', 'ANALYZING', 'ANALYZED', 'DRAFTED', 'APPROVED', 'SENT', 'FAILED', 'READ']) {
      expect(MESSAGE_STATUSES).toContain(status);
    }
  });

  it('tem os 3 níveis de automação da secção 8', () => {
    expect(AUTOMATION_LEVELS).toEqual(['AUTO', 'DRAFT', 'HUMAN_REQUIRED']);
  });

  it('tem as 6 categorias de contacto da secção 13', () => {
    expect(CONTACT_CATEGORIES).toHaveLength(6);
    expect(CONTACT_CATEGORIES).toContain('FORNECEDOR');
  });

  it('não tem valores repetidos em nenhuma lista', () => {
    const lists = {
      PRIORITIES,
      INTENTS,
      CONVERSATION_STATUSES,
      MESSAGE_STATUSES,
      AUTOMATION_LEVELS,
      DRAFT_STATUSES,
      CONTACT_CATEGORIES,
    };

    for (const [name, values] of Object.entries(lists)) {
      expect(new Set(values).size, `${name} tem valores repetidos`).toBe(values.length);
    }
  });

  it('as conversas fechadas são as que saem do painel', () => {
    expect(CLOSED_CONVERSATION_STATUSES).toEqual(['RESOLVED', 'ARCHIVED']);
  });

  it('os tipos com media são os que exigem media_id', () => {
    expect(MEDIA_MESSAGE_TYPES).toEqual(['image', 'document', 'audio', 'video', 'sticker']);
  });
});

describe('highestPriority', () => {
  it('escolhe sempre a mais grave', () => {
    expect(highestPriority('NORMAL', 'URGENTE')).toBe('URGENTE');
    expect(highestPriority('URGENTE', 'NORMAL')).toBe('URGENTE');
    expect(highestPriority('ACOMPANHAR', 'IMPORTANTE')).toBe('IMPORTANTE');
    expect(highestPriority('NORMAL', 'ACOMPANHAR')).toBe('ACOMPANHAR');
  });

  it('devolve a mesma quando são iguais', () => {
    for (const priority of PRIORITIES) {
      expect(highestPriority(priority, priority)).toBe(priority);
    }
  });

  it('impede uma conversa urgente de descer para normal', () => {
    // O caso concreto: o cliente diz que a obra está parada (URGENTE) e a
    // seguir escreve "obrigado" (NORMAL). A conversa continua urgente até
    // alguém a resolver.
    const conversaAtual = 'URGENTE' as const;
    const novaMensagem = 'NORMAL' as const;

    expect(highestPriority(conversaAtual, novaMensagem)).toBe('URGENTE');
  });

  it('deixa uma conversa normal subir para urgente', () => {
    expect(highestPriority('NORMAL', 'URGENTE')).toBe('URGENTE');
  });
});

describe('comparePriority', () => {
  it('ordena da mais grave para a menos grave', () => {
    const baralhado = ['NORMAL', 'URGENTE', 'ACOMPANHAR', 'IMPORTANTE'] as const;

    expect([...baralhado].sort(comparePriority)).toEqual([
      'URGENTE',
      'IMPORTANTE',
      'ACOMPANHAR',
      'NORMAL',
    ]);
  });

  it('coincide com a ordem declarada em PRIORITIES', () => {
    // A mesma ordem existe no enum do PostgreSQL, o que permite usar
    // `ORDER BY priority` sem CASE.
    expect([...PRIORITIES].sort(comparePriority)).toEqual([...PRIORITIES]);
  });
});
