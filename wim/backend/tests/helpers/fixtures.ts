/**
 * Construtores de dados para os testes.
 *
 * Cada função cria o mínimo necessário e devolve o id, para que cada teste
 * diga apenas o que lhe interessa e não repita o resto.
 */
import { getPool } from '../../src/database/pool.js';
import { migrateUp } from '../../src/database/migrator.js';
import { resetSchema } from './database.js';

/** Base de dados vazia com todas as migrações aplicadas. */
export async function freshSchema(): Promise<void> {
  await resetSchema();
  await migrateUp();
}

let sequence = 0;
const nextSequence = (): number => {
  sequence += 1;
  return sequence;
};

export async function createUser(
  overrides: { email?: string; name?: string; role?: string } = {},
): Promise<string> {
  const n = nextSequence();
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, '$argon2id$fake', $2, $3::user_role)
     RETURNING id`,
    [
      overrides.email ?? `utilizador${n}@exemplo.mz`,
      overrides.name ?? `Utilizador ${n}`,
      overrides.role ?? 'AGENT',
    ],
  );
  return result.rows[0]!.id;
}

export async function createContact(
  overrides: { waId?: string; phone?: string; name?: string; category?: string } = {},
): Promise<string> {
  const n = nextSequence();
  const suffix = String(n).padStart(6, '0');

  const result = await getPool().query<{ id: string }>(
    `INSERT INTO contacts (wa_id, phone_e164, display_name, category)
     VALUES ($1, $2, $3, $4::contact_category)
     RETURNING id`,
    [
      overrides.waId ?? `25884${suffix}`,
      overrides.phone ?? `+25884${suffix}`,
      overrides.name ?? `Contacto ${n}`,
      overrides.category ?? 'PROSPECT',
    ],
  );
  return result.rows[0]!.id;
}

export async function createConversation(
  contactId: string,
  overrides: { status?: string; priority?: string; resolvedAt?: Date | null } = {},
): Promise<string> {
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO conversations (contact_id, status, priority, resolved_at, last_message_at)
     VALUES ($1, $2::conversation_status, $3::message_priority, $4, now())
     RETURNING id`,
    [
      contactId,
      overrides.status ?? 'OPEN',
      overrides.priority ?? 'NORMAL',
      overrides.resolvedAt ?? null,
    ],
  );
  return result.rows[0]!.id;
}

export async function createMessage(
  conversationId: string,
  contactId: string,
  overrides: {
    direction?: string;
    waMessageId?: string | null;
    body?: string;
    status?: string;
  } = {},
): Promise<string> {
  const n = nextSequence();
  const direction = overrides.direction ?? 'INBOUND';
  const waMessageId =
    overrides.waMessageId === undefined ? `wamid.TESTE${n}` : overrides.waMessageId;

  const result = await getPool().query<{ id: string }>(
    `INSERT INTO messages (conversation_id, contact_id, direction, wa_message_id, body, status)
     VALUES ($1, $2, $3::message_direction, $4, $5, $6::message_status)
     RETURNING id`,
    [
      conversationId,
      contactId,
      direction,
      waMessageId,
      overrides.body ?? `Mensagem de teste ${n}`,
      overrides.status ?? 'RECEIVED',
    ],
  );
  return result.rows[0]!.id;
}

/** Um conjunto completo: contacto → conversa → mensagem. */
export async function createThread(): Promise<{
  contactId: string;
  conversationId: string;
  messageId: string;
}> {
  const contactId = await createContact();
  const conversationId = await createConversation(contactId);
  const messageId = await createMessage(conversationId, contactId);
  return { contactId, conversationId, messageId };
}
