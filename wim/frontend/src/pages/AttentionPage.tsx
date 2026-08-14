import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { api, type ConversationSummaryDto } from '@/services/api';

export function AttentionPage() {
  const { session } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['conversations', 'attention', session?.accessToken],
    queryFn: async () => {
      if (!session) throw new Error('Não autenticado');
      return api.conversations.attention(session.accessToken);
    },
    enabled: !!session,
    refetchInterval: 30_000,
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

  if (!data || data.data.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
        <p className="text-slate-600">Nenhuma conversa que necessite atenção neste momento.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">Precisa da Minha Atenção</h1>
        <p className="mt-1 text-sm text-slate-500">
          {data.data.length} conversa{data.data.length !== 1 ? 's' : ''} que requerem intervenção.
        </p>
      </header>

      <div className="space-y-3">
        {data.data.map((conv) => (
          <ConversationCard key={conv.id} conversation={conv} />
        ))}
      </div>
    </div>
  );
}

function ConversationCard({ conversation }: { conversation: ConversationSummaryDto }) {
  const priorityStyles: Record<'URGENTE' | 'IMPORTANTE' | 'ACOMPANHAR' | 'NORMAL', { ring: string; bg: string; text: string; emoji: string }> = {
    URGENTE: { ring: 'border-urgente-border', bg: 'bg-urgente-soft', text: 'text-urgente', emoji: '🔴' },
    IMPORTANTE: { ring: 'border-importante-border', bg: 'bg-importante-soft', text: 'text-importante', emoji: '🟠' },
    ACOMPANHAR: { ring: 'border-acompanhar-border', bg: 'bg-acompanhar-soft', text: 'text-acompanhar', emoji: '🟡' },
    NORMAL: { ring: 'border-normal-border', bg: 'bg-normal-soft', text: 'text-normal', emoji: '🟢' },
  };

  const style = priorityStyles[conversation.priority];
  const contactName = conversation.contact.displayName || conversation.contact.profileName || conversation.contact.phone;

  return (
    <article className={`rounded-xl border ${style.ring} ${style.bg} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span aria-hidden="true">{style.emoji}</span>
            <h2 className="font-semibold text-slate-900">{contactName}</h2>
            {conversation.subject && (
              <span className="text-xs text-slate-600">— {conversation.subject}</span>
            )}
          </div>

          {conversation.analysis.summary && (
            <p className="mt-2 text-sm text-slate-700">{conversation.analysis.summary}</p>
          )}

          {conversation.analysis.recommendedAction && (
            <p className="mt-1 text-xs text-slate-600">
              <strong>Ação recomendada:</strong> {conversation.analysis.recommendedAction}
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
            {conversation.lastMessagePreview && (
              <span>Última: "{conversation.lastMessagePreview.substring(0, 50)}…"</span>
            )}
            {conversation.unreadCount > 0 && (
              <span className="font-semibold">
                {conversation.unreadCount} não lida{conversation.unreadCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-xs text-slate-600">
            {conversation.minutesSinceLastInbound !== null
              ? `${conversation.minutesSinceLastInbound}m atrás`
              : 'Sem mensagens'}
          </p>
        </div>
      </div>
    </article>
  );
}
