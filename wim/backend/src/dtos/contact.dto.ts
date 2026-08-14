import type { ContactRow } from '../models/domain.js';
import type { ContactCategory } from '../models/enums.js';
import { toIso, toIsoRequired } from './common.dto.js';

export interface ContactDto {
  id: string;
  waId: string;
  phone: string;
  /** O nome a mostrar: o definido no painel tem prioridade sobre o do perfil. */
  name: string;
  profileName: string | null;
  displayName: string | null;
  company: string | null;
  location: string | null;
  notes: string | null;
  category: ContactCategory;
  firstContactAt: string;
  lastContactAt: string;
  conversationCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Que nome mostrar ao utilizador.
 *
 * Preferimos o nome que o utilizador definiu; depois o do perfil do WhatsApp;
 * e, em último caso, o telefone — nunca um espaço em branco no painel.
 */
export function resolveContactName(row: {
  display_name: string | null;
  profile_name: string | null;
  phone_e164: string;
}): string {
  return row.display_name?.trim() || row.profile_name?.trim() || row.phone_e164;
}

export function toContactDto(row: ContactRow): ContactDto {
  return {
    id: row.id,
    waId: row.wa_id,
    phone: row.phone_e164,
    name: resolveContactName(row),
    profileName: row.profile_name,
    displayName: row.display_name,
    company: row.company,
    location: row.location,
    notes: row.notes,
    category: row.category,
    firstContactAt: toIsoRequired(row.first_contact_at),
    lastContactAt: toIsoRequired(row.last_contact_at),
    conversationCount: row.conversation_count,
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIso(row.updated_at) ?? toIsoRequired(row.created_at),
  };
}

/** Versão reduzida, para embutir noutras respostas sem as inchar. */
export interface ContactSummaryDto {
  id: string;
  name: string;
  phone: string;
  company: string | null;
  category: ContactCategory;
}

export function toContactSummaryDto(row: {
  id: string;
  display_name: string | null;
  profile_name: string | null;
  phone_e164: string;
  company: string | null;
  category: ContactCategory;
}): ContactSummaryDto {
  return {
    id: row.id,
    name: resolveContactName(row),
    phone: row.phone_e164,
    company: row.company,
    category: row.category,
  };
}
