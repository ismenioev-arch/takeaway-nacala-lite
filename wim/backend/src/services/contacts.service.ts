/**
 * Regras de negócio dos contactos (especificação, secção 13).
 *
 * O controlador trata de HTTP; o repositório trata de SQL; as decisões estão
 * aqui no meio.
 */
import { AppError } from '../middleware/errors.js';
import { toContactDto, type ContactDto } from '../dtos/contact.dto.js';
import { paginate, type Paginated } from '../dtos/common.dto.js';
import * as contactsRepo from '../repositories/contacts.repository.js';
import type {
  CreateContactInput,
  ListContactsQuery,
  UpdateContactInput,
} from '../validators/contact.validators.js';
import { AUDIT_ACTIONS, diffValues, recordAudit, type Actor } from './audit.service.js';

/** Violação de restrição única do PostgreSQL. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const candidate = error as { code?: string; constraint?: string };
  if (candidate.code !== UNIQUE_VIOLATION) return false;

  return constraint === undefined || candidate.constraint === constraint;
}

export async function listContacts(query: ListContactsQuery): Promise<Paginated<ContactDto>> {
  const { rows, total } = await contactsRepo.listContacts({
    q: query.q,
    category: query.category,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    page: query.page,
    pageSize: query.pageSize,
  });

  return paginate(rows.map(toContactDto), query.page, query.pageSize, total);
}

export async function getContact(id: string): Promise<ContactDto> {
  const row = await contactsRepo.findContactById(id);

  if (!row) {
    throw AppError.notFound('Contacto não encontrado.');
  }

  return toContactDto(row);
}

export async function createContact(
  input: CreateContactInput,
  actor?: Actor,
): Promise<ContactDto> {
  // O identificador do WhatsApp é o telefone sem o '+'. Quando não é indicado,
  // derivamo-lo do telefone para que o contacto criado à mão no painel se
  // ligue sozinho à primeira mensagem que chegar dessa pessoa.
  const waId = input.waId ?? input.phone.replace(/^\+/, '');

  try {
    const row = await contactsRepo.insertContact({
      waId,
      phone: input.phone,
      displayName: input.displayName ?? null,
      company: input.company ?? null,
      location: input.location ?? null,
      notes: input.notes ?? null,
      category: input.category,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.contactCreated,
      entityType: 'contacts',
      entityId: row.id,
      newValue: { waId: row.wa_id, phone: row.phone_e164, category: row.category },
      actor,
    });

    return toContactDto(row);
  } catch (error) {
    if (isUniqueViolation(error, 'contacts_wa_id_key')) {
      throw AppError.conflict('Já existe um contacto com este número de WhatsApp.', {
        waId,
      });
    }
    throw error;
  }
}

export async function updateContact(
  id: string,
  input: UpdateContactInput,
  actor?: Actor,
): Promise<ContactDto> {
  const before = await contactsRepo.findContactById(id);

  if (!before) {
    throw AppError.notFound('Contacto não encontrado.');
  }

  const after = await contactsRepo.updateContact(id, input);

  if (!after) {
    // Só acontece se o contacto for apagado entre as duas consultas.
    throw AppError.notFound('Contacto não encontrado.');
  }

  const { oldValue, newValue, changed } = diffValues(before, after, [
    'display_name',
    'company',
    'location',
    'notes',
    'category',
  ]);

  // Um PATCH que não muda nada não polui o histórico de auditoria.
  if (changed) {
    await recordAudit({
      action: AUDIT_ACTIONS.contactUpdated,
      entityType: 'contacts',
      entityId: id,
      oldValue,
      newValue,
      actor,
    });
  }

  return toContactDto(after);
}

export async function deleteContact(id: string, actor?: Actor): Promise<void> {
  const existing = await contactsRepo.findContactById(id);

  if (!existing) {
    throw AppError.notFound('Contacto não encontrado.');
  }

  // A auditoria é gravada ANTES de apagar: depois do DELETE em cascata já não
  // haveria de onde ler o que foi removido.
  await recordAudit({
    action: AUDIT_ACTIONS.contactDeleted,
    entityType: 'contacts',
    entityId: id,
    oldValue: {
      waId: existing.wa_id,
      phone: existing.phone_e164,
      name: existing.display_name ?? existing.profile_name,
    },
    actor,
  });

  await contactsRepo.deleteContact(id);
}
