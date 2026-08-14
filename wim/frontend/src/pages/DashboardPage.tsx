import { BackendStatus } from '@/components/BackendStatus';
import { useConversationCounts } from '@/hooks/useConversationCounts';

interface PriorityCard {
  label: string;
  emoji: string;
  ring: string;
  text: string;
  background: string;
  key: 'urgente' | 'importante' | 'acompanhar' | 'normal';
}

const PRIORITY_CARDS: PriorityCard[] = [
  {
    label: 'Urgentes',
    emoji: '🔴',
    ring: 'border-urgente-border',
    text: 'text-urgente',
    background: 'bg-urgente-soft',
    key: 'urgente',
  },
  {
    label: 'Importantes',
    emoji: '🟠',
    ring: 'border-importante-border',
    text: 'text-importante',
    background: 'bg-importante-soft',
    key: 'importante',
  },
  {
    label: 'Acompanhar',
    emoji: '🟡',
    ring: 'border-acompanhar-border',
    text: 'text-acompanhar',
    background: 'bg-acompanhar-soft',
    key: 'acompanhar',
  },
  {
    label: 'Normais',
    emoji: '🟢',
    ring: 'border-normal-border',
    text: 'text-normal',
    background: 'bg-normal-soft',
    key: 'normal',
  },
];

export function DashboardPage() {
  const { data: counts, isLoading, error } = useConversationCounts();

  const getCountValue = (key: string): string | number => {
    if (isLoading) return '…';
    if (error) return '!';
    if (!counts) return '—';
    return counts[key as keyof typeof counts] ?? '—';
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">Painel</h1>
        <p className="mt-1 text-sm text-slate-500">
          Fase 5: autenticação, dados reais, navegação.
        </p>
      </header>

      <BackendStatus />

      <section aria-labelledby="prioridades">
        <h2 id="prioridades" className="mb-3 text-sm font-semibold text-slate-700">
          Por prioridade
        </h2>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {PRIORITY_CARDS.map((card) => (
            <article
              key={card.label}
              className={`rounded-xl border ${card.ring} ${card.background} p-4`}
            >
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <span aria-hidden="true">{card.emoji}</span>
                {card.label}
              </p>
              <p className={`mt-1 text-2xl font-bold tabular-nums ${card.text}`}>
                {getCountValue(card.key)}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="resumo">
        <h2 id="resumo" className="mb-3 text-sm font-semibold text-slate-700">
          Resumo
        </h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <article className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-600">Total de conversas</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
              {getCountValue('total')}
            </p>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-600">Não respondidas</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
              {getCountValue('unanswered')}
            </p>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-600">A aguardar aprovação</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
              {getCountValue('awaitingApproval')}
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
