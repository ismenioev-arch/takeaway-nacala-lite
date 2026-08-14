import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';

/**
 * Estado do backend. Repete a cada 30 segundos para que o painel mostre
 * quando o servidor cai, em vez de ficar com dados antigos em silêncio.
 */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 30_000,
    retry: 1,
  });
}
