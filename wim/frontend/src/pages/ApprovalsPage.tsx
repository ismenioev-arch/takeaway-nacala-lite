/**
 * Aprovações — onde a pessoa decide o que o cliente vai receber.
 *
 * O ecrã foi desenhado à volta de uma pergunta: *posso decidir isto sem
 * abrir mais nada?* Cada cartão mostra a mensagem do cliente, o que a IA
 * percebeu, e o texto proposto já dentro de uma caixa editável. Os três
 * botões fazem exactamente o que dizem, e o de enviar está sempre à
 * direita e sozinho, porque é o único que não tem volta.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError, type PendingDraftDto } from '@/services/api';

export function ApprovalsPage() {
  const { session } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['drafts', 'pending', session?.accessToken],
    queryFn: async () => {
      if (!session) throw new Error('Não autenticado');
      return api.drafts.pending(session.accessToken);
    },
    enabled: !!session,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-slate-500">A carregar respostas por aprovar...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-800">Erro ao carregar as respostas por aprovar.</p>
      </div>
    );
  }

  const drafts = data?.data ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">Respostas por Aprovar</h1>
        <p className="mt-1 text-sm text-slate-500">
          {drafts.length === 0
            ? 'Nada à espera de si.'
            : `${drafts.length} resposta${drafts.length !== 1 ? 's' : ''} à espera da sua decisão. Nada é enviado sem que carregue em Enviar.`}
        </p>
      </header>

      {/* Se a integração estiver desligada, mais vale dizê-lo já do que
          deixar alguém escrever uma resposta para depois falhar. */}
      {data && !data.canSend && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            <strong>Envio desligado.</strong> A ligação ao WhatsApp não está configurada neste
            ambiente. Pode editar e cancelar rascunhos, mas o envio só funciona depois de
            configurar as credenciais da Meta.
          </p>
        </div>
      )}

      {drafts.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
          <p className="text-slate-600">Não há respostas à espera de aprovação.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => (
            <DraftCard key={draft.id} draft={draft} canSend={data?.canSend ?? false} />
          ))}
        </div>
      )}
    </div>
  );
}

const PRIORITY_STYLES: Record<
  'URGENTE' | 'IMPORTANTE' | 'ACOMPANHAR' | 'NORMAL',
  { ring: string; bg: string; text: string; emoji: string }
> = {
  URGENTE: { ring: 'border-urgente-border', bg: 'bg-urgente-soft', text: 'text-urgente', emoji: '🔴' },
  IMPORTANTE: { ring: 'border-importante-border', bg: 'bg-importante-soft', text: 'text-importante', emoji: '🟠' },
  ACOMPANHAR: { ring: 'border-acompanhar-border', bg: 'bg-acompanhar-soft', text: 'text-acompanhar', emoji: '🟡' },
  NORMAL: { ring: 'border-normal-border', bg: 'bg-normal-soft', text: 'text-normal', emoji: '🟢' },
};

function DraftCard({ draft, canSend }: { draft: PendingDraftDto; canSend: boolean }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState(draft.effectiveContent);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'erro'; message: string } | null>(null);

  // Se a lista for recarregada e o texto tiver mudado do lado do servidor
  // (outra pessoa editou), acompanha — mas só enquanto não houver edição
  // local por guardar.
  useEffect(() => {
    setText(draft.effectiveContent);
  }, [draft.effectiveContent]);

  const dirty = text.trim() !== draft.effectiveContent.trim();
  const style = PRIORITY_STYLES[draft.conversationPriority];
  const contactName = draft.contact.name ?? draft.contact.phone;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['drafts', 'pending'] });

  const onError = (err: unknown) => {
    setFeedback({
      kind: 'erro',
      message: err instanceof ApiError ? err.message : 'Não foi possível concluir a operação.',
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Não autenticado');
      return api.drafts.edit(session.accessToken, draft.id, text.trim());
    },
    onSuccess: () => {
      setFeedback({ kind: 'ok', message: 'Alteração guardada. Ainda não foi enviada.' });
      void refresh();
    },
    onError,
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Não autenticado');
      return api.drafts.cancel(session.accessToken, draft.id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['drafts', 'pending'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Não autenticado');
      // Manda o texto do ecrã quando está editado: evita o caso de alguém
      // escrever, não guardar, e enviar a versão antiga.
      return api.drafts.send(session.accessToken, draft.id, dirty ? text.trim() : undefined);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['drafts', 'pending'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError,
  });

  const busy = saveMutation.isPending || cancelMutation.isPending || sendMutation.isPending;

  const confidence = useMemo(() => {
    if (draft.analysis.confidence === null) return null;
    return `${Math.round(draft.analysis.confidence * 100)}%`;
  }, [draft.analysis.confidence]);

  return (
    <article className={`rounded-xl border ${style.ring} ${style.bg} p-4`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden>{style.emoji}</span>
          <h2 className="font-semibold text-slate-900">{contactName}</h2>
          <span className={`text-xs font-medium uppercase ${style.text}`}>
            {draft.conversationPriority}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {draft.analysis.intent && <span className="rounded bg-white/70 px-2 py-0.5">{draft.analysis.intent}</span>}
          {confidence && <span>confiança {confidence}</span>}
          {draft.status === 'EDITED' && (
            <span className="rounded bg-white/70 px-2 py-0.5 font-medium text-slate-700">editado</span>
          )}
        </div>
      </header>

      {/* O que o cliente disse. */}
      <div className="mt-3 rounded-lg bg-white/80 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Mensagem do cliente
        </p>
        <p className="mt-1 text-sm text-slate-800">
          {draft.inbound.body ?? <em className="text-slate-500">({draft.inbound.type})</em>}
        </p>
      </div>

      {/* O que a IA percebeu. */}
      {(draft.analysis.summary || draft.analysis.urgencyReason || draft.analysis.recommendedAction) && (
        <div className="mt-2 space-y-1 px-1 text-sm text-slate-700">
          {draft.analysis.summary && <p>{draft.analysis.summary}</p>}
          {draft.analysis.urgencyReason && (
            <p className="text-slate-600">
              <strong>Porquê urgente:</strong> {draft.analysis.urgencyReason}
            </p>
          )}
          {draft.analysis.recommendedAction && (
            <p className="text-slate-600">
              <strong>Sugestão:</strong> {draft.analysis.recommendedAction}
            </p>
          )}
        </div>
      )}

      {/* O que vai ser enviado — editável. */}
      <div className="mt-3">
        <label
          htmlFor={`resposta-${draft.id}`}
          className="text-xs font-medium uppercase tracking-wide text-slate-400"
        >
          Resposta proposta
        </label>
        <textarea
          id={`resposta-${draft.id}`}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setFeedback(null);
          }}
          rows={4}
          disabled={busy}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:opacity-60"
        />
        {dirty && (
          <p className="mt-1 text-xs text-slate-500">
            Alterado. Será esta versão a ser enviada.
          </p>
        )}
      </div>

      {feedback && (
        <p
          className={`mt-2 text-sm ${feedback.kind === 'erro' ? 'text-red-700' : 'text-emerald-700'}`}
        >
          {feedback.message}
        </p>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => cancelMutation.mutate()}
          disabled={busy}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={busy || !dirty || text.trim() === ''}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {saveMutation.isPending ? 'A guardar...' : 'Guardar alteração'}
        </button>

        <span className="flex-1" />

        <button
          type="button"
          onClick={() => sendMutation.mutate()}
          disabled={busy || !canSend || text.trim() === ''}
          title={canSend ? undefined : 'O envio está desligado neste ambiente.'}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {sendMutation.isPending ? 'A enviar...' : 'Enviar ao cliente'}
        </button>
      </footer>
    </article>
  );
}
