/**
 * Pesquisa global (especificação, secção 30).
 *
 * Um único termo procurado em contactos, conversas e mensagens. As três
 * consultas correm em paralelo: são independentes, e em série a latência
 * somava-se sem necessidade.
 */
import type { SearchResultDto } from '../dtos/message.dto.js';
import type { Priority } from '../models/enums.js';
import { getPool } from '../database/pool.js';
import { resolveContactName } from '../dtos/contact.dto.js';
import { likePattern } from '../repositories/query-builder.js';

interface ContactHit {
  id: string;
  display_name: string | null;
  profile_name: string | null;
  phone_e164: string;
  company: string | null;
}

interface ConversationHit {
  id: string;
  subject: string | null;
  priority: Priority;
  last_message_at: Date | null;
  display_name: string | null;
  profile_name: string | null;
  phone_e164: string;
}

interface MessageHit {
  id: string;
  conversation_id: string;
  body: string | null;
  wa_timestamp: Date;
  display_name: string | null;
  profile_name: string | null;
  phone_e164: string;
}

/**
 * Recorta o texto à volta da ocorrência, para o resultado mostrar o contexto
 * em vez do início de uma mensagem longa.
 */
export function buildExcerpt(body: string | null, term: string, radius = 60): string {
  if (!body) return '';

  const index = body.toLowerCase().indexOf(term.toLowerCase());
  if (index === -1) return body.slice(0, radius * 2);

  const start = Math.max(0, index - radius);
  const end = Math.min(body.length, index + term.length + radius);

  return `${start > 0 ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`;
}

export async function searchEverything(term: string, limit: number): Promise<SearchResultDto> {
  const pool = getPool();
  const pattern = likePattern(term);

  const [contacts, conversations, messages] = await Promise.all([
    pool.query<ContactHit>(
      `SELECT id, display_name, profile_name, phone_e164, company
         FROM contacts
        WHERE search_text ILIKE $1
        ORDER BY last_contact_at DESC
        LIMIT $2`,
      [pattern, limit],
    ),
    pool.query<ConversationHit>(
      `SELECT c.id, c.subject, c.priority, c.last_message_at,
              ct.display_name, ct.profile_name, ct.phone_e164
         FROM conversations c
         JOIN contacts ct ON ct.id = c.contact_id
        WHERE c.subject ILIKE $1 OR ct.search_text ILIKE $1
        ORDER BY c.priority ASC, c.last_message_at DESC NULLS LAST
        LIMIT $2`,
      [pattern, limit],
    ),
    pool.query<MessageHit>(
      `SELECT m.id, m.conversation_id, m.body, m.wa_timestamp,
              ct.display_name, ct.profile_name, ct.phone_e164
         FROM messages m
         JOIN contacts ct ON ct.id = m.contact_id
        WHERE m.body ILIKE $1
        ORDER BY m.wa_timestamp DESC
        LIMIT $2`,
      [pattern, limit],
    ),
  ]);

  return {
    contacts: contacts.rows.map((row) => ({
      id: row.id,
      name: resolveContactName(row),
      phone: row.phone_e164,
      company: row.company,
    })),
    conversations: conversations.rows.map((row) => ({
      id: row.id,
      contactName: resolveContactName(row),
      subject: row.subject,
      priority: row.priority,
      lastMessageAt: row.last_message_at ? row.last_message_at.toISOString() : null,
    })),
    messages: messages.rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      contactName: resolveContactName(row),
      excerpt: buildExcerpt(row.body, term),
      timestamp: row.wa_timestamp.toISOString(),
    })),
  };
}
