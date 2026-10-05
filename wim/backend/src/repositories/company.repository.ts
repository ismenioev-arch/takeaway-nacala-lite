/**
 * O que a empresa deixa a IA saber.
 *
 * Este ficheiro é a fronteira do conhecimento do modelo. Tudo o que a
 * Claude sabe sobre o negócio sai destas quatro consultas — e,
 * sobretudo, tudo o que não sai delas é invisível para ela.
 *
 * A consulta dos preços é a mais importante: filtra por
 * `is_authorized_for_ai`, que é falso por omissão. Um preço novo nunca
 * aparece numa resposta automática por esquecimento; aparece porque
 * alguém decidiu, explicitamente, que podia.
 */
import { getPool, type Queryable } from '../database/pool.js';

export interface CompanyProfileRow {
  id: number;
  name: string;
  description: string | null;
  location: string | null;
  business_hours: Record<string, unknown>;
  contact_phone: string | null;
  contact_email: string | null;
  policies: string | null;
  service_rules: string | null;
  auto_reply_enabled: boolean;
}

export interface CompanyServiceRow {
  id: string;
  name: string;
  description: string | null;
}

export interface CompanyPriceRow {
  id: string;
  service_id: string | null;
  service_name: string | null;
  label: string;
  amount: string;
  currency: string;
  notes: string | null;
}

export interface CompanyFaqRow {
  id: string;
  question: string;
  answer: string;
}

export async function findCompanyProfile(
  db: Queryable = getPool(),
): Promise<CompanyProfileRow | null> {
  const result = await db.query<CompanyProfileRow>(
    `SELECT * FROM company_profile WHERE id = 1`,
  );

  return result.rows[0] ?? null;
}

export async function listActiveServices(
  db: Queryable = getPool(),
): Promise<CompanyServiceRow[]> {
  const result = await db.query<CompanyServiceRow>(
    `SELECT id, name, description
       FROM company_services
      WHERE is_active
      ORDER BY display_order, name`,
  );

  return result.rows;
}

/**
 * Só os preços autorizados. O `WHERE` é a regra de negócio.
 *
 * Não existe variante desta função sem o filtro, de propósito: se
 * existisse, mais cedo ou mais tarde alguém chamava a errada.
 */
export async function listAiAuthorizedPrices(
  db: Queryable = getPool(),
): Promise<CompanyPriceRow[]> {
  const result = await db.query<CompanyPriceRow>(
    `SELECT p.id, p.service_id, s.name AS service_name,
            p.label, p.amount, p.currency, p.notes
       FROM company_prices p
       LEFT JOIN company_services s ON s.id = p.service_id
      WHERE p.is_authorized_for_ai
      ORDER BY s.display_order NULLS LAST, p.label`,
  );

  return result.rows;
}

export async function listActiveFaqs(db: Queryable = getPool()): Promise<CompanyFaqRow[]> {
  const result = await db.query<CompanyFaqRow>(
    `SELECT id, question, answer
       FROM company_faqs
      WHERE is_active
      ORDER BY display_order, question`,
  );

  return result.rows;
}
