import { BackendStatus } from '@/components/BackendStatus';

/**
 * Painel principal (especificação, secções 9 e 28).
 *
 * Na FASE 1 os cartões existem mas ainda não têm dados — não há tabela de
 * mensagens até à FASE 2. Estão aqui com valor "—" de propósito: a ordem
 * visual das prioridades (urgente primeiro) é uma decisão de desenho que
 * queremos fixada desde já, e é mais honesto mostrar "sem dados" do que
 * inventar números.
 */

interface PriorityCard {
  label: string;
  emoji: string;
  ring: string;
  text: string;
  background: string;
}

const PRIORITY_CARDS: PriorityCard[] = [
  {
    label: 'Urgentes',
    emoji: '🔴',
    ring: 'border-urgente-border',
    text: 'text-urgente',
    background: 'bg-urgente-soft',
  },
  {
    label: 'Importantes',
    emoji: '🟠',
    ring: 'border-importante-border',
    text: 'text-importante',
    background: 'bg-importante-soft',
  },
  {
    label: 'Acompanhar',
    emoji: '🟡',
    ring: 'border-acompanhar-border',
    text: 'text-acompanhar',
    background: 'bg-acompanhar-soft',
  },
  {
    label: 'Normais',
    emoji: '🟢',
    ring: 'border-normal-border',
    text: 'text-normal',
    background: 'bg-normal-soft',
  },
];

const SECONDARY_CARDS = ['Total de conversas', 'Não respondidas', 'A aguardar aprovação'];

export function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">Painel</h1>
        <p className="mt-1 text-sm text-slate-500">
          Fase 1 concluída: as fundações estão de pé. Os números aparecem quando as mensagens
          começarem a chegar.
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
              <p className={`mt-1 text-2xl font-bold tabular-nums ${card.text}`}>—</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="resumo">
        <h2 id="resumo" className="mb-3 text-sm font-semibold text-slate-700">
          Resumo
        </h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {SECONDARY_CARDS.map((label) => (
            <article key={label} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-600">{label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">—</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">A seguir</h2>
        <ol className="mt-2 space-y-1 text-sm text-slate-600">
          <li>
            <strong>Fase 2</strong> — tabelas de contactos, conversas, mensagens e análises
          </li>
          <li>
            <strong>Fase 3 e 4</strong> — API base e autenticação
          </li>
          <li>
            <strong>Fase 6 e 7</strong> — webhook do WhatsApp e recepção de mensagens
          </li>
        </ol>
      </section>
    </div>
  );
}
