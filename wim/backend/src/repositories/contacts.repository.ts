/**
 * Acesso a `contacts`.
 *
 * Os repositórios são o único sítio que escreve SQL. Recebem um `Queryable`
 * em vez de irem buscar o pool: assim a mesma função serve dentro e fora de
 * uma transacção.
 */
import type { ContactRow } from '../models/domain.js';
import type { ContactCategory } from '../models/enums.js';
import { getPool, type Queryable } from '../database/pool.js';
import { Conditions, likePattern, resolveOrderBy } from './query-builder.js';

const COLUMNS = `
  id, wa_id, phone_e164, profile_name, display_name, company, location, notes,
  category, first_contact_at, last_contact_at, conversation_count,
  search_text, created_at, updated_at
`;

const SORT_COLUMNS = {
  lastContactAt: 'last_contact_at',
  firstContactAt: 'first_contact_at',
  name: 'coalesce(display_name, profile_name, phone_e164)',
} as const;

export type ContactSortField = keyof typeof SORT_COLUMNS;

export interface ListContactsFilters {
  q?: string | undefined;
  category?: readonly ContactCategory[] | undefined;
  sortBy: ContactSortField;
  sortDirection: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface ListResult<T> {
  rows: T[];
  total: number;
}

function buildFilters(filters: ListContactsFilters): Conditions {
  const conditions = new Conditions();

  conditions.addIfNotEmpty('category = ANY(?)', filters.category);

  // `search_text` é a coluna calculada pelo PostgreSQL que junta nome,
  // empresa e telefone. O índice trigram torna o ILIKE '%...%' viável.
  if (filters.q) {
    conditions.add('search_text ILIKE ?', likePattern(filters.q));
  }

  return conditions;
}

export async function listContacts(
  filters: ListContactsFilters,
  db: Queryable = getPool(),
): Promise<ListResult<ContactRow>> {
  const conditions = buildFilters(filters);
  const where = conditions.toWhere();
  const values = conditions.toValues();

  const totalResult = await db.query<{ total: string }>(
    `SELECT count(*) AS total FROM contacts ${where}`,
    values,
  );
  const total = Number(totalResult.rows[0]?.total ?? 0);

  // Sem resultados não vale a pena uma segunda ida à base de dados.
  if (total === 0) return { rows: [], total: 0 };

  const orderBy = resolveOrderBy(SORT_COLUMNS, filters.sortBy, filters.sortDirection);
  const limitIndex = conditions.nextIndex;

  const rows = await db.query<ContactRow>(
    `SELECT ${COLUMNS}
       FROM contacts
       ${where}
      ORDER BY ${orderBy}, id
      LIMIT $${limitIndex} OFFSET $${limitIndex + 1}`,
    [...values, filters.pageSize, (filters.page - 1) * filters.pageSize],
  );

  return { rows: rows.rows, total };
}

export async function findContactById(
  id: string,
  db: Queryable = getPool(),
): Promise<ContactRow | null> {
  const result = await db.query<ContactRow>(
    `SELECT ${COLUMNS} FROM contacts WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findContactByWaId(
  waId: string,
  db: Queryable = getPool(),
): Promise<ContactRow | null> {
  const result = await db.query<ContactRow>(
    `SELECT ${COLUMNS} FROM contacts WHERE wa_id = $1`,
    [waId],
  );
  return result.rows[0] ?? null;
}

export async function findContactByPhone(
  phone: string,
  db: Queryable = getPool(),
): Promise<ContactRow | null> {
  const result = await db.query<ContactRow>(
    `SELECT ${COLUMNS} FROM contacts WHERE phone_e164 = $1 LIMIT 1`,
    [phone],
  );
  return result.rows[0] ?? null;
}

export interface CreateContactData {
  waId: string;
  phone: string;
  displayName?: string | null;
  profileName?: string | null;
  company?: string | null;
  location?: string | null;
  notes?: string | null;
  category: ContactCategory;
}

export async function insertContact(
  data: CreateContactData,
  db: Queryable = getPool(),
): Promise<ContactRow> {
  const result = await db.query<ContactRow>(
    `INSERT INTO contacts
       (wa_id, phone_e164, display_name, profile_name, company, location, notes, category)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLUMNS}`,
    [
      data.waId,
      data.phone,
      data.displayName ?? null,
      data.profileName ?? null,
      data.company ?? null,
      data.location ?? null,
      data.notes ?? null,
      data.category,
    ],
  );

  return result.rows[0]!;
}

export interface UpdateContactData {
  displayName?: string | null;
  company?: string | null;
  location?: string | null;
  notes?: string | null;
  category?: ContactCategory;
}

/** Mapeia os campos da API para colunas. Só estas podem ser actualizadas. */
const UPDATABLE_COLUMNS: Record<keyof UpdateContactData, string> = {
  displayName: 'display_name',
  company: 'company',
  location: 'location',
  notes: 'notes',
  category: 'category',
};

export async function updateContact(
  id: string,
  data: UpdateContactData,
  db: Queryable = getPool(),
): Promise<ContactRow | null> {
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const [field, column] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = data[field as keyof UpdateContactData];
    if (value === undefined) continue;

    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }

  if (assignments.length === 0) {
    return findContactById(id, db);
  }

  values.push(id);

  const result = await db.query<ContactRow>(
    `UPDATE contacts SET ${assignments.join(', ')}
      WHERE id = $${values.length}
      RETURNING ${COLUMNS}`,
    values,
  );

  return result.rows[0] ?? null;
}

export async function deleteContact(id: string, db: Queryable = getPool()): Promise<boolean> {
  const result = await db.query(`DELETE FROM contacts WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
