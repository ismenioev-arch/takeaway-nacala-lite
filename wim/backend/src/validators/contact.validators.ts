import { z } from 'zod';
import { CONTACT_CATEGORIES } from '../models/enums.js';
import {
  multiValue,
  optionalText,
  paginationSchema,
  phoneE164Schema,
  requiredText,
  searchTermSchema,
  sortDirectionSchema,
} from './common.validators.js';

const categorySchema = z.enum(CONTACT_CATEGORIES);

/** Colunas por que é possível ordenar contactos. */
export const CONTACT_SORT_FIELDS = ['lastContactAt', 'firstContactAt', 'name'] as const;

export const listContactsQuerySchema = paginationSchema.extend({
  q: searchTermSchema.optional(),
  category: multiValue(categorySchema),
  sortBy: z.enum(CONTACT_SORT_FIELDS).default('lastContactAt'),
  sortDirection: sortDirectionSchema,
});
export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;

export const createContactSchema = z.object({
  // O identificador do WhatsApp normalmente chega pelo webhook; aqui é
  // opcional para permitir registar um contacto antes do primeiro contacto.
  waId: requiredText(64, 'o identificador do WhatsApp').optional(),
  phone: phoneE164Schema,
  displayName: optionalText(200),
  company: optionalText(200),
  location: optionalText(200),
  notes: optionalText(4000),
  category: categorySchema.default('PROSPECT'),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = z
  .object({
    displayName: optionalText(200),
    company: optionalText(200),
    location: optionalText(200),
    notes: optionalText(4000),
    category: categorySchema.optional(),
  })
  // Um PATCH vazio é quase sempre um engano de quem chama, não uma operação
  // legítima. Recusar dá um erro claro em vez de um sucesso silencioso.
  .refine((value) => Object.keys(value).length > 0, {
    message: 'indique pelo menos um campo para actualizar',
  });
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
