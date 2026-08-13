/**
 * Regras do domínio garantidas pela base de dados.
 *
 * Cobre conversas, contactos, mensagens, auditoria, notificações,
 * acompanhamentos, pesquisa e o comportamento em cascata.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../../src/database/pool.js';
import {
  createContact,
  createConversation,
  createMessage,
  createUser,
  freshSchema,
} from '../helpers/fixtures.js';

beforeAll(async () => {
  await freshSchema();
});

afterAll(async () => {
  await closePool();
});

describe('contacts', () => {
  it('recusa um telefone fora do formato E.164', async () => {
    for (const phone of ['840000000', '00258840000000', '+0840000000', 'telefone']) {
      await expect(
        getPool().query(
          `INSERT INTO contacts (wa_id, phone_e164) VALUES ($1, $2)`,
          [`wa-${phone}`, phone],
        ),
      ).rejects.toThrow(/contacts_phone_e164_format/);
    }
  });

  it('aceita um número moçambicano bem formado', async () => {
    const result = await getPool().query(
      `INSERT INTO contacts (wa_id, phone_e164, display_name)
       VALUES ('258840001234', '+258840001234', 'Cliente Teste')
       RETURNING id, category`,
    );

    expect(result.rowCount).toBe(1);
    // Quem escreve pela primeira vez ainda não é cliente.
    expect((result.rows[0] as { category: string }).category).toBe('PROSPECT');
  });

  it('recusa dois contactos com o mesmo identificador do WhatsApp', async () => {
    await expect(
      getPool().query(
        `INSERT INTO contacts (wa_id, phone_e164) VALUES ('258840001234', '+258840009999')`,
      ),
    ).rejects.toThrow(/contacts_wa_id_key/);
  });

  it('recusa uma data de último contacto anterior à do primeiro', async () => {
    await expect(
      getPool().query(
        `INSERT INTO contacts (wa_id, phone_e164, first_contact_at, last_contact_at)
         VALUES ('258840005555', '+258840005555', now(), now() - interval '1 day')`,
      ),
    ).rejects.toThrow(/contacts_contact_dates_ordered/);
  });

  it('mantém a coluna de pesquisa sincronizada sozinha', async () => {
    const contactId = await createContact({ name: 'Maria Alberto' });

    await getPool().query(`UPDATE contacts SET company = 'Obras do Norte' WHERE id = $1`, [
      contactId,
    ]);

    const result = await getPool().query<{ search_text: string }>(
      `SELECT search_text FROM contacts WHERE id = $1`,
      [contactId],
    );

    expect(result.rows[0]!.search_text).toContain('Maria Alberto');
    expect(result.rows[0]!.search_text).toContain('Obras do Norte');
  });

  it('encontra um contacto por nome parcial (secção 30)', async () => {
    await createContact({ name: 'Joaquim Nhantumbo' });

    const result = await getPool().query<{ display_name: string }>(
      `SELECT display_name FROM contacts WHERE search_text ILIKE '%nhantumbo%'`,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.display_name).toBe('Joaquim Nhantumbo');
  });

  it('encontra um contacto pelo telefone', async () => {
    const result = await getPool().query(
      `SELECT id FROM contacts WHERE search_text LIKE '%840001234%'`,
    );

    expect(result.rowCount).toBe(1);
  });
});

describe('conversations', () => {
  it('permite apenas uma conversa aberta por contacto', async () => {
    const contactId = await createContact();
    await createConversation(contactId, { status: 'OPEN' });

    await expect(createConversation(contactId, { status: 'NEW' })).rejects.toThrow(
      /conversations_one_open_per_contact_idx/,
    );
  });

  it('permite abrir uma conversa nova depois de a anterior ser resolvida', async () => {
    const contactId = await createContact();
    const first = await createConversation(contactId, { status: 'OPEN' });

    await getPool().query(
      `UPDATE conversations SET status = 'RESOLVED', resolved_at = now() WHERE id = $1`,
      [first],
    );

    const second = await createConversation(contactId, { status: 'NEW' });
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('recusa marcar como resolvida sem data de resolução', async () => {
    const contactId = await createContact();
    const conversationId = await createConversation(contactId);

    await expect(
      getPool().query(`UPDATE conversations SET status = 'RESOLVED' WHERE id = $1`, [
        conversationId,
      ]),
    ).rejects.toThrow(/conversations_resolved_has_timestamp/);
  });

  it('recusa uma contagem de não lidas negativa', async () => {
    const contactId = await createContact();
    const conversationId = await createConversation(contactId);

    await expect(
      getPool().query(`UPDATE conversations SET unread_count = -1 WHERE id = $1`, [
        conversationId,
      ]),
    ).rejects.toThrow(/conversations_unread_not_negative/);
  });

  it('ordena as urgências primeiro, sem precisar de CASE (secções 9 e 28)', async () => {
    await getPool().query('DELETE FROM conversations');

    for (const priority of ['NORMAL', 'URGENTE', 'ACOMPANHAR', 'IMPORTANTE']) {
      const contactId = await createContact();
      await createConversation(contactId, { priority });
    }

    const result = await getPool().query<{ priority: string }>(
      `SELECT priority FROM conversations ORDER BY priority, last_message_at DESC`,
    );

    expect(result.rows.map((row) => row.priority)).toEqual([
      'URGENTE',
      'IMPORTANTE',
      'ACOMPANHAR',
      'NORMAL',
    ]);
  });
});

describe('messages', () => {
  let contactId: string;
  let conversationId: string;

  beforeAll(async () => {
    contactId = await createContact();
    conversationId = await createConversation(contactId);
  });

  it('recusa uma mensagem de texto sem texto', async () => {
    await expect(
      getPool().query(
        `INSERT INTO messages (conversation_id, contact_id, direction, wa_message_id, type, body)
         VALUES ($1, $2, 'INBOUND', 'wamid.vazia', 'text', '   ')`,
        [conversationId, contactId],
      ),
    ).rejects.toThrow(/messages_text_requires_body/);
  });

  it('recusa uma imagem sem identificador de media', async () => {
    await expect(
      getPool().query(
        `INSERT INTO messages (conversation_id, contact_id, direction, wa_message_id, type)
         VALUES ($1, $2, 'INBOUND', 'wamid.imagem', 'image')`,
        [conversationId, contactId],
      ),
    ).rejects.toThrow(/messages_media_requires_media_id/);
  });

  it('aceita uma imagem com media e legenda', async () => {
    const result = await getPool().query(
      `INSERT INTO messages (conversation_id, contact_id, direction, wa_message_id,
                             type, media_id, media_mime, caption)
       VALUES ($1, $2, 'INBOUND', 'wamid.imagem-ok', 'image',
               'media-123', 'image/jpeg', 'Fotografia da fundação')
       RETURNING id`,
      [conversationId, contactId],
    );

    expect(result.rowCount).toBe(1);
  });

  it('aceita uma localização sem texto nem media', async () => {
    const result = await getPool().query(
      `INSERT INTO messages (conversation_id, contact_id, direction, wa_message_id, type, raw)
       VALUES ($1, $2, 'INBOUND', 'wamid.local', 'location',
               '{"latitude": -14.54, "longitude": 40.67}'::jsonb)
       RETURNING id`,
      [conversationId, contactId],
    );

    expect(result.rowCount).toBe(1);
  });

  it('recusa o estado FAILED sem motivo', async () => {
    await expect(
      getPool().query(
        `INSERT INTO messages (conversation_id, contact_id, direction, body, status)
         VALUES ($1, $2, 'OUTBOUND', 'resposta', 'FAILED')`,
        [conversationId, contactId],
      ),
    ).rejects.toThrow(/messages_failed_requires_reason/);
  });

  it('guarda o motivo quando o envio falha', async () => {
    const result = await getPool().query(
      `INSERT INTO messages (conversation_id, contact_id, direction, body, status,
                             error_code, error_detail)
       VALUES ($1, $2, 'OUTBOUND', 'resposta', 'FAILED', '131047',
               'Fora da janela de 24 horas')
       RETURNING id`,
      [conversationId, contactId],
    );

    expect(result.rowCount).toBe(1);
  });

  it('encontra mensagens por texto parcial (secção 30)', async () => {
    await createMessage(conversationId, contactId, {
      body: 'Preciso mudar a fundação amanhã',
    });

    const result = await getPool().query<{ body: string }>(
      `SELECT body FROM messages WHERE body ILIKE '%fundação%'`,
    );

    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('audit_logs — imutável (secção 24)', () => {
  let logId: string;

  beforeAll(async () => {
    const userId = await createUser({ role: 'ADMIN' });
    const result = await getPool().query<{ id: string }>(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value, ip_address)
       VALUES ($1, 'draft.approved', 'ai_drafts', gen_random_uuid(),
               '{"status":"DRAFT"}'::jsonb, '{"status":"APPROVED"}'::jsonb, '192.0.2.10')
       RETURNING id`,
      [userId],
    );
    logId = result.rows[0]!.id;
  });

  it('aceita a inserção do registo', async () => {
    const result = await getPool().query(`SELECT id FROM audit_logs WHERE id = $1`, [logId]);
    expect(result.rowCount).toBe(1);
  });

  it('recusa alterar um registo', async () => {
    await expect(
      getPool().query(`UPDATE audit_logs SET action = 'apagado' WHERE id = $1`, [logId]),
    ).rejects.toThrow(/audit_logs é imutável/);
  });

  it('recusa apagar um registo', async () => {
    await expect(
      getPool().query(`DELETE FROM audit_logs WHERE id = $1`, [logId]),
    ).rejects.toThrow(/audit_logs é imutável/);
  });

  it('aceita registos do sistema, sem utilizador', async () => {
    const result = await getPool().query(
      `INSERT INTO audit_logs (action, entity_type)
       VALUES ('message.auto_replied', 'ai_drafts')
       RETURNING user_id`,
    );

    expect((result.rows[0] as { user_id: string | null }).user_id).toBeNull();
  });

  it('recusa uma acção vazia', async () => {
    await expect(
      getPool().query(`INSERT INTO audit_logs (action, entity_type) VALUES ('  ', 'x')`),
    ).rejects.toThrow(/audit_logs_action_not_blank/);
  });
});

describe('notifications (secção 21)', () => {
  it('recusa marcar como lida sem data de leitura', async () => {
    await expect(
      getPool().query(
        `INSERT INTO notifications (type, title, is_read)
         VALUES ('URGENT_MESSAGE', 'Nova urgência', true)`,
      ),
    ).rejects.toThrow(/notifications_read_has_timestamp/);
  });

  it('cria uma notificação de urgência ligada à conversa', async () => {
    const contactId = await createContact();
    const conversationId = await createConversation(contactId, { priority: 'URGENTE' });

    const result = await getPool().query(
      `INSERT INTO notifications (type, priority, title, body, conversation_id, contact_id)
       VALUES ('URGENT_MESSAGE', 'URGENTE', 'Nova urgência',
               'Obra com início amanhã.', $1, $2)
       RETURNING id, is_read`,
      [conversationId, contactId],
    );

    expect(result.rowCount).toBe(1);
    expect((result.rows[0] as { is_read: boolean }).is_read).toBe(false);
  });

  it('lista as não lidas mais recentes primeiro', async () => {
    const result = await getPool().query(
      `SELECT id FROM notifications WHERE is_read = false ORDER BY created_at DESC`,
    );

    expect(result.rowCount).toBeGreaterThanOrEqual(1);
  });
});

describe('follow_ups (secção 31)', () => {
  it('recusa marcar como concluído sem data de conclusão', async () => {
    const contactId = await createContact();
    const conversationId = await createConversation(contactId);

    await expect(
      getPool().query(
        `INSERT INTO follow_ups (conversation_id, contact_id, due_at, status)
         VALUES ($1, $2, now() + interval '3 days', 'DONE')`,
        [conversationId, contactId],
      ),
    ).rejects.toThrow(/follow_ups_done_has_timestamp/);
  });

  it('cria o lembrete "verificar o cliente daqui a 3 dias"', async () => {
    const contactId = await createContact();
    const conversationId = await createConversation(contactId);

    const result = await getPool().query(
      `INSERT INTO follow_ups (conversation_id, contact_id, due_at, note)
       VALUES ($1, $2, now() + interval '3 days', 'Verificar se respondeu à proposta.')
       RETURNING id, status`,
      [conversationId, contactId],
    );

    expect((result.rows[0] as { status: string }).status).toBe('PENDING');
  });

  it('encontra os lembretes vencidos', async () => {
    const contactId = await createContact();
    const conversationId = await createConversation(contactId);

    await getPool().query(
      `INSERT INTO follow_ups (conversation_id, contact_id, due_at, note)
       VALUES ($1, $2, now() - interval '1 hour', 'Já devia ter sido verificado')`,
      [conversationId, contactId],
    );

    const result = await getPool().query(
      `SELECT id FROM follow_ups WHERE status = 'PENDING' AND due_at <= now()`,
    );

    expect(result.rowCount).toBeGreaterThanOrEqual(1);
  });
});

describe('etiquetas', () => {
  it('recusa uma cor fora do formato hexadecimal', async () => {
    await expect(
      getPool().query(`INSERT INTO tags (name, color) VALUES ('Teste', 'vermelho')`),
    ).rejects.toThrow(/tags_color_format/);
  });

  it('trata o nome sem distinguir maiúsculas', async () => {
    await getPool().query(`INSERT INTO tags (name) VALUES ('Obra')`);

    await expect(
      getPool().query(`INSERT INTO tags (name) VALUES ('OBRA')`),
    ).rejects.toThrow(/tags_name_key/);
  });

  it('associa e desassocia etiquetas de conversas', async () => {
    const contactId = await createContact();
    const conversationId = await createConversation(contactId);

    const tag = await getPool().query<{ id: string }>(
      `INSERT INTO tags (name) VALUES ('Licenciamento') RETURNING id`,
    );

    await getPool().query(
      `INSERT INTO conversation_tags (conversation_id, tag_id) VALUES ($1, $2)`,
      [conversationId, tag.rows[0]!.id],
    );

    // A chave primária composta impede associar a mesma etiqueta duas vezes.
    await expect(
      getPool().query(
        `INSERT INTO conversation_tags (conversation_id, tag_id) VALUES ($1, $2)`,
        [conversationId, tag.rows[0]!.id],
      ),
    ).rejects.toThrow(/conversation_tags_pkey/);
  });
});

describe('company_profile — só existe uma empresa', () => {
  it('aceita a primeira linha', async () => {
    const result = await getPool().query(
      `INSERT INTO company_profile (name) VALUES ('Gabinete de Engenharia') RETURNING id`,
    );

    expect((result.rows[0] as { id: number }).id).toBe(1);
  });

  it('recusa uma segunda empresa', async () => {
    await expect(
      getPool().query(`INSERT INTO company_profile (id, name) VALUES (2, 'Outra')`),
    ).rejects.toThrow(/company_profile_singleton/);
  });

  it('a resposta automática está desligada por omissão', async () => {
    const result = await getPool().query<{ auto_reply_enabled: boolean }>(
      `SELECT auto_reply_enabled FROM company_profile WHERE id = 1`,
    );

    expect(result.rows[0]!.auto_reply_enabled).toBe(false);
  });
});

describe('comportamento em cascata', () => {
  it('apagar um contacto apaga as conversas, mensagens, análises e rascunhos', async () => {
    const contactId = await createContact();
    const conversationId = await createConversation(contactId);
    const messageId = await createMessage(conversationId, contactId);

    await getPool().query(
      `INSERT INTO message_analysis
         (message_id, priority, intent, confidence, summary, requires_human, model, prompt_version)
       VALUES ($1, 'NORMAL', 'INFORMACAO', 0.95, 'resumo', false, 'claude-opus-5', 'v1')`,
      [messageId],
    );

    await getPool().query(
      `INSERT INTO ai_drafts (message_id, conversation_id, automation_level, content)
       VALUES ($1, $2, 'DRAFT', 'sugestão')`,
      [messageId, conversationId],
    );

    await getPool().query(`DELETE FROM contacts WHERE id = $1`, [contactId]);

    for (const [table, column, value] of [
      ['conversations', 'id', conversationId],
      ['messages', 'id', messageId],
      ['message_analysis', 'message_id', messageId],
      ['ai_drafts', 'message_id', messageId],
    ] as const) {
      const result = await getPool().query(
        `SELECT 1 FROM ${table} WHERE ${column} = $1`,
        [value],
      );
      expect(result.rowCount, `${table} devia ter ficado vazia`).toBe(0);
    }
  });

  it('recusa apagar um utilizador que já aprovou respostas', async () => {
    // A cadeia de responsabilidade da secção 3 não pode ser quebrada. Se
    // apagar o utilizador pusesse o aprovador a NULL, ficaríamos com uma
    // resposta "aprovada por ninguém". A base de dados recusa: quem já
    // aprovou desactiva-se, não se apaga.
    const userId = await createUser();
    const contactId = await createContact();
    const conversationId = await createConversation(contactId);
    const messageId = await createMessage(conversationId, contactId);

    await getPool().query(
      `INSERT INTO ai_drafts (message_id, conversation_id, automation_level, content,
                              status, approved_by_user_id, approved_at)
       VALUES ($1, $2, 'DRAFT', 'sugestão', 'APPROVED', $3, now())`,
      [messageId, conversationId, userId],
    );

    await expect(
      getPool().query(`DELETE FROM users WHERE id = $1`, [userId]),
    ).rejects.toThrow(/ai_drafts_approved_by_user_id_fkey/);
  });

  it('desactivar o utilizador é o caminho correcto, e preserva o histórico', async () => {
    const userId = await createUser();
    const contactId = await createContact();
    const conversationId = await createConversation(contactId);
    const messageId = await createMessage(conversationId, contactId);

    const draft = await getPool().query<{ id: string }>(
      `INSERT INTO ai_drafts (message_id, conversation_id, automation_level, content,
                              status, approved_by_user_id, approved_at)
       VALUES ($1, $2, 'DRAFT', 'sugestão', 'APPROVED', $3, now())
       RETURNING id`,
      [messageId, conversationId, userId],
    );

    await getPool().query(`UPDATE users SET is_active = false WHERE id = $1`, [userId]);

    const result = await getPool().query<{ approved_by_user_id: string; name: string }>(
      `SELECT d.approved_by_user_id, u.name
         FROM ai_drafts d JOIN users u ON u.id = d.approved_by_user_id
        WHERE d.id = $1`,
      [draft.rows[0]!.id],
    );

    // Continua a saber-se exactamente quem aprovou.
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.approved_by_user_id).toBe(userId);
  });

  it('recusa apagar um utilizador com registos de auditoria', async () => {
    const userId = await createUser();
    await getPool().query(
      `INSERT INTO audit_logs (user_id, action, entity_type) VALUES ($1, 'login', 'users')`,
      [userId],
    );

    await expect(
      getPool().query(`DELETE FROM users WHERE id = $1`, [userId]),
    ).rejects.toThrow(/audit_logs_user_id_fkey/);
  });
});
