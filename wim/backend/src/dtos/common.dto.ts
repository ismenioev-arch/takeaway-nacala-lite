/**
 * Formas partilhadas da API.
 *
 * A base de dados usa snake_case (é a convenção do PostgreSQL); a API usa
 * camelCase (é a convenção do TypeScript e do frontend). A tradução acontece
 * aqui, nos DTOs, e em mais lado nenhum — assim uma alteração de coluna não
 * se propaga até ao painel.
 */

/** Envelope de todas as listagens. */
export interface Paginated<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export function buildPagination(page: number, pageSize: number, total: number): PaginationMeta {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;

  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
}

export function paginate<T>(data: T[], page: number, pageSize: number, total: number): Paginated<T> {
  return { data, pagination: buildPagination(page, pageSize, total) };
}

/** Datas viajam sempre em ISO 8601 UTC, para não haver ambiguidade de fuso. */
export const toIso = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

export const toIsoRequired = (value: Date): string => value.toISOString();
