import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api, type ConversationSummaryDto } from '@/services/api';

export function ConversationsPage() {
  const { session } = useAuth();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    status: 'OPEN',
    pageSize: 25,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['conversations', 'list', page, filters, session?.accessToken],
    queryFn: async () => {
      if (!session) throw new Error('Não autenticado');
      return api.conversations.list(session.accessToken, {
        page,
        ...filters,
      });
    },
    enabled: !!session,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-slate-500">A carregar conversas...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-800">Erro ao carregar conversas.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">Conversas</h1>
        <p className="mt-1 text-sm text-slate-500">
          {data?.pagination.total ?? 0} conversa{data?.pagination.total !== 1 ? 's' : ''}
        </p>
      </header>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          value={filters.status}
          onChange={(e) => {
            setFilters({ ...filters, status: e.target.value });
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="OPEN">Abertas</option>
          <option value="RESOLVED">Resolvidas</option>
          <option value="">Todas</option>
        </select>
      </div>

      {data && data.data.length > 0 ? (
        <>
          <div className="space-y-3">
            {data.data.map((conv) => (
              <ConversationListItem key={conv.id} conversation={conv} />
            ))}
          </div>

          {data.pagination.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between">
              <p className="text-sm text-slate-600">
                Página {data.pagination.page} de {data.pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={!data.pagination.hasPrevious}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:text-slate-400"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={!data.pagination.hasNext}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:text-slate-400"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
          <p className="text-slate-600">Nenhuma conversa encontrada.</p>
        </div>
      )}
    </div>
  );
}

function ConversationListItem({ conversation }: { conversation: ConversationSummaryDto }) {
  const contactName = conversation.contact.displayName || conversation.contact.profileName || conversation.contact.phone;
  const priorityEmoji = {
    URGENTE: '🔴',
    IMPORTANTE: '🟠',
    ACOMPANHAR: '🟡',
    NORMAL: '🟢',
  }[conversation.priority];

  return (
    <article className="rounded-lg border border-slate-200 p-4 hover:bg-slate-50">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span>{priorityEmoji}</span>
            <h3 className="font-semibold text-slate-900">{contactName}</h3>
          </div>
          {conversation.subject && (
            <p className="mt-1 text-sm text-slate-600">{conversation.subject}</p>
          )}
          {conversation.lastMessagePreview && (
            <p className="mt-1 text-xs text-slate-500">"{conversation.lastMessagePreview}"</p>
          )}
        </div>
        <div className="text-right text-xs text-slate-500">
          {conversation.unreadCount > 0 && (
            <span className="block font-semibold text-slate-900">{conversation.unreadCount} não lidas</span>
          )}
          {conversation.lastMessageAt && (
            <span>{new Date(conversation.lastMessageAt).toLocaleDateString('pt-PT')}</span>
          )}
        </div>
      </div>
    </article>
  );
}
