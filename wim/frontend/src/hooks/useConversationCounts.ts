import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { api } from '@/services/api';

export function useConversationCounts() {
  const { session } = useAuth();

  return useQuery({
    queryKey: ['conversations', 'counts', session?.accessToken],
    queryFn: async () => {
      if (!session) throw new Error('Não autenticado');
      return api.conversations.counts(session.accessToken);
    },
    enabled: !!session,
    refetchInterval: 30_000, // Atualizar a cada 30 segundos
    staleTime: 25_000,
  });
}
