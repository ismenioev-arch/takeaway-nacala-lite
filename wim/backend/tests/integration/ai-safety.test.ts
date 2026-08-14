/**
 * A regra de segurança da IA (especificação, secções 3, 7 e 8).
 *
 *   AI → ANALISA → RECOMENDA → HUMANO APROVA → EXECUTA
 *
 * Estes testes tentam activamente quebrar a regra por SQL directo, ignorando
 * qualquer lógica da aplicação. Se passarem, a garantia é da base de dados —
 * e continua de pé mesmo que um dia haja um erro no código do backend.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../../src/database/pool.js';
import { createThread, createUser, freshSchema } from '../helpers/fixtures.js';

let conversationId: string;
let messageId: string;
let userId: string;

/** Insere um rascunho, deixando o teste dizer só o que lhe interessa. */
async function insertDraft(fields: {
  level: string;
  status: string;
  content?: string;
  editedContent?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  sentMessageId?: string | null;
  errorCode?: string | null;
}) {
  return getPool().query(
    `INSERT INTO ai_drafts (
       message_id, conversation_id, automation_level, content, edited_content,
       status, approved_by_user_id, approved_at, sent_message_id, error_code
     )
     VALUES ($1, $2, $3::automation_level, $4, $5, $6::draft_status, $7, $8, $9, $10)
     RETURNING id`,
    [
      messageId,
      conversationId,
      fields.level,
      fields.content ?? 'Recebi a sua mensagem. Vou verificar e retorno.',
      fields.editedContent ?? null,
      fields.status,
      fields.approvedBy ?? null,
      fields.approvedAt ?? null,
      fields.sentMessageId ?? null,
      fields.errorCode ?? null,
    ],
  );
}

beforeAll(async () => {
  await freshSchema();
  const thread = await createThread();
  conversationId = thread.conversationId;
  messageId = thread.messageId;
  userId = await createUser({ role: 'OWNER' });
});

afterAll(async () => {
  await closePool();
});

describe('regra 1 — "aprovado" significa "um humano aprovou"', () => {
  it('recusa APPROVED sem utilizador', async () => {
    await expect(
      insertDraft({ level: 'DRAFT', status: 'APPROVED', approvedAt: 'now()' }),
    ).rejects.toThrow(/ai_drafts_approved_requires_human|ai_drafts_approval_fields_together/);
  });

  it('recusa APPROVED sem data de aprovação', async () => {
    await expect(
      insertDraft({ level: 'DRAFT', status: 'APPROVED', approvedBy: userId }),
    ).rejects.toThrow(/ai_drafts_approved_requires_human|ai_drafts_approval_fields_together/);
  });

  it('aceita APPROVED com utilizador e data', async () => {
    const result = await insertDraft({
      level: 'DRAFT',
      status: 'APPROVED',
      approvedBy: userId,
      approvedAt: new Date().toISOString(),
    });

    expect(result.rowCount).toBe(1);
    await getPool().query('DELETE FROM ai_drafts');
  });

  it('recusa passar um rascunho existente a APPROVED sem utilizador', async () => {
    // O ataque mais provável não é a inserção — é um UPDATE que se esquece
    // de preencher quem aprovou.
    const inserted = await insertDraft({ level: 'DRAFT', status: 'DRAFT' });
    const draftId = (inserted.rows[0] as { id: string }).id;

    await expect(
      getPool().query(`UPDATE ai_drafts SET status = 'APPROVED' WHERE id = $1`, [draftId]),
    ).rejects.toThrow(/ai_drafts_approved_requires_human/);

    await getPool().query('DELETE FROM ai_drafts');
  });
});

describe('regra 2 — só o nível AUTO pode ser enviado sem aprovação', () => {
  it('recusa enviar um rascunho HUMAN_REQUIRED sem utilizador', async () => {
    // Este é o caso que a especificação mais protege: orçamentos, pagamentos,
    // reclamações e contratos nunca podem sair sozinhos.
    await expect(
      insertDraft({
        level: 'HUMAN_REQUIRED',
        status: 'SENT',
        sentMessageId: messageId,
      }),
    ).rejects.toThrow(/ai_drafts_send_requires_human_unless_auto/);
  });

  it('recusa enviar um rascunho DRAFT sem utilizador', async () => {
    await expect(
      insertDraft({ level: 'DRAFT', status: 'SENT', sentMessageId: messageId }),
    ).rejects.toThrow(/ai_drafts_send_requires_human_unless_auto/);
  });

  it('aceita enviar um rascunho AUTO sem utilizador', async () => {
    // Nível 1 da secção 8: saudações, horários, moradas. Pode sair sozinho.
    const result = await insertDraft({
      level: 'AUTO',
      status: 'SENT',
      content: 'O nosso horário é de segunda a sexta, das 08h00 às 17h00.',
      sentMessageId: messageId,
    });

    expect(result.rowCount).toBe(1);
    await getPool().query('DELETE FROM ai_drafts');
  });

  it('aceita enviar um rascunho HUMAN_REQUIRED depois de um humano aprovar', async () => {
    const result = await insertDraft({
      level: 'HUMAN_REQUIRED',
      status: 'SENT',
      approvedBy: userId,
      approvedAt: new Date().toISOString(),
      sentMessageId: messageId,
    });

    expect(result.rowCount).toBe(1);
    await getPool().query('DELETE FROM ai_drafts');
  });

  it('recusa marcar como enviado sem apontar a mensagem que saiu', async () => {
    await expect(insertDraft({ level: 'AUTO', status: 'SENT' })).rejects.toThrow(
      /ai_drafts_sent_requires_message/,
    );
  });
});

describe('integridade do rascunho', () => {
  it('recusa conteúdo vazio', async () => {
    await expect(
      insertDraft({ level: 'DRAFT', status: 'DRAFT', content: '   ' }),
    ).rejects.toThrow(/ai_drafts_content_not_blank/);
  });

  it('recusa o estado EDITED sem edição', async () => {
    await expect(insertDraft({ level: 'DRAFT', status: 'EDITED' })).rejects.toThrow(
      /ai_drafts_edited_requires_edit/,
    );
  });

  it('recusa FAILED sem motivo', async () => {
    await expect(insertDraft({ level: 'DRAFT', status: 'FAILED' })).rejects.toThrow(
      /ai_drafts_failed_requires_reason/,
    );
  });

  it('preserva o texto original da IA quando o humano edita', async () => {
    // O que a IA propôs tem de continuar visível depois da edição: é isso que
    // permite perceber, mais tarde, se a IA está a ser útil ou não.
    const inserted = await insertDraft({ level: 'DRAFT', status: 'DRAFT' });
    const draftId = (inserted.rows[0] as { id: string }).id;

    await getPool().query(
      `UPDATE ai_drafts SET status = 'EDITED', edited_content = $2 WHERE id = $1`,
      [draftId, 'Bom dia João, passo na obra amanhã às 09h00.'],
    );

    const stored = await getPool().query<{ content: string; edited_content: string }>(
      `SELECT content, edited_content FROM ai_drafts WHERE id = $1`,
      [draftId],
    );

    expect(stored.rows[0]!.content).toContain('Vou verificar');
    expect(stored.rows[0]!.edited_content).toContain('passo na obra');

    await getPool().query('DELETE FROM ai_drafts');
  });

  it('permite apenas um rascunho por decidir para a mesma mensagem', async () => {
    await insertDraft({ level: 'DRAFT', status: 'DRAFT' });

    await expect(insertDraft({ level: 'DRAFT', status: 'DRAFT' })).rejects.toThrow(
      /ai_drafts_one_pending_per_message_idx/,
    );

    await getPool().query('DELETE FROM ai_drafts');
  });

  it('permite um rascunho novo depois de o anterior ser cancelado', async () => {
    const first = await insertDraft({ level: 'DRAFT', status: 'DRAFT' });
    await getPool().query(`UPDATE ai_drafts SET status = 'CANCELLED' WHERE id = $1`, [
      (first.rows[0] as { id: string }).id,
    ]);

    const second = await insertDraft({ level: 'DRAFT', status: 'DRAFT' });
    expect(second.rowCount).toBe(1);

    await getPool().query('DELETE FROM ai_drafts');
  });
});

describe('a IA só vê os preços autorizados (secções 7 e 20)', () => {
  beforeAll(async () => {
    await getPool().query(
      `INSERT INTO company_services (id, name)
       VALUES ('a0000000-0000-4000-8000-00000000000f', 'Serviço de teste')`,
    );

    await getPool().query(
      `INSERT INTO company_prices (service_id, label, amount, is_authorized_for_ai) VALUES
         ('a0000000-0000-4000-8000-00000000000f', 'Visita técnica',  5000.00, true),
         ('a0000000-0000-4000-8000-00000000000f', 'Projecto por m2',  850.00, false)`,
    );
  });

  it('um preço novo NÃO fica autorizado por omissão', async () => {
    // O valor por omissão é `false` de propósito: um preço acrescentado à
    // pressa nunca deve ficar exposto por esquecimento.
    const result = await getPool().query<{ is_authorized_for_ai: boolean }>(
      `INSERT INTO company_prices (label, amount)
       VALUES ('Preço acrescentado sem pensar', 999.00)
       RETURNING is_authorized_for_ai`,
    );

    expect(result.rows[0]!.is_authorized_for_ai).toBe(false);
  });

  it('a consulta que alimenta a IA devolve apenas os autorizados', async () => {
    const result = await getPool().query<{ label: string }>(
      `SELECT label FROM company_prices WHERE is_authorized_for_ai ORDER BY label`,
    );

    const labels = result.rows.map((row) => row.label);
    expect(labels).toEqual(['Visita técnica']);
    expect(labels).not.toContain('Projecto por m2');
  });

  it('recusa um preço negativo', async () => {
    await expect(
      getPool().query(
        `INSERT INTO company_prices (label, amount) VALUES ('Preço inválido', -1)`,
      ),
    ).rejects.toThrow(/company_prices_amount_not_negative/);
  });

  it('recusa duas linhas com a mesma etiqueta no mesmo serviço', async () => {
    // Duas linhas iguais tornariam ambíguo qual delas a IA pode comunicar.
    await expect(
      getPool().query(
        `INSERT INTO company_prices (service_id, label, amount)
         VALUES ('a0000000-0000-4000-8000-00000000000f', 'Visita técnica', 7000.00)`,
      ),
    ).rejects.toThrow(/company_prices_service_label_idx/);
  });
});

describe('a análise da IA tem de ser utilizável', () => {
  it('recusa uma confiança fora do intervalo 0–1', async () => {
    await expect(
      getPool().query(
        `INSERT INTO message_analysis
           (message_id, priority, intent, confidence, summary, requires_human, model, prompt_version)
         VALUES ($1, 'NORMAL', 'INFORMACAO', 1.5, 'resumo', false, 'claude-opus-5', 'v1')`,
        [messageId],
      ),
    ).rejects.toThrow(/message_analysis_confidence_range/);
  });

  it('recusa um resumo vazio', async () => {
    await expect(
      getPool().query(
        `INSERT INTO message_analysis
           (message_id, priority, intent, confidence, summary, requires_human, model, prompt_version)
         VALUES ($1, 'NORMAL', 'INFORMACAO', 0.9, '   ', false, 'claude-opus-5', 'v1')`,
        [messageId],
      ),
    ).rejects.toThrow(/message_analysis_summary_not_blank/);
  });

  it('recusa marcar como URGENTE sem dizer porquê', async () => {
    // O painel mostra o motivo da urgência ao utilizador (secção 10). Sem ele,
    // a classificação não serve para decidir nada.
    await expect(
      getPool().query(
        `INSERT INTO message_analysis
           (message_id, priority, intent, confidence, summary, requires_human, model, prompt_version)
         VALUES ($1, 'URGENTE', 'OBRA', 0.94, 'Obra parada', true, 'claude-opus-5', 'v1')`,
        [messageId],
      ),
    ).rejects.toThrow(/message_analysis_urgent_requires_reason/);
  });

  it('aceita uma análise urgente completa', async () => {
    const result = await getPool().query(
      `INSERT INTO message_analysis
         (message_id, priority, intent, confidence, summary, urgency_reason,
          requires_human, recommended_action, model, prompt_version,
          tokens_input, tokens_output, latency_ms)
       VALUES ($1, 'URGENTE', 'ALTERACAO_PROJETO', 0.94,
               'Cliente precisa de alterar a planta antes do início da fundação.',
               'O cliente informou que a fundação começa amanhã.',
               true, 'Contactar o cliente imediatamente.',
               'claude-opus-5', 'v1', 1200, 180, 2400)
       RETURNING id`,
      [messageId],
    );

    expect(result.rowCount).toBe(1);
  });

  it('permite apenas uma análise por mensagem', async () => {
    await expect(
      getPool().query(
        `INSERT INTO message_analysis
           (message_id, priority, intent, confidence, summary, requires_human, model, prompt_version)
         VALUES ($1, 'NORMAL', 'INFORMACAO', 0.9, 'segunda análise', false, 'claude-opus-5', 'v1')`,
        [messageId],
      ),
    ).rejects.toThrow(/message_analysis_message_id_key/);
  });
});
