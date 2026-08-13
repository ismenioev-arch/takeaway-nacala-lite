import { useHealth } from '@/hooks/useHealth';

/**
 * Mostra se o backend responde. Na FASE 1 é a prova visível de que as duas
 * metades do sistema estão ligadas; mais tarde continua útil para o utilizador
 * perceber, num relance, que o sistema deixou de receber mensagens.
 */
export function BackendStatus({ compact = false }: { compact?: boolean }) {
  const { data, isLoading, isError, error } = useHealth();

  const state = isLoading
    ? { dot: 'bg-slate-300', label: 'A ligar…', tone: 'text-slate-500' }
    : isError || data?.status !== 'ok'
      ? { dot: 'bg-urgente', label: 'Sem ligação', tone: 'text-urgente' }
      : { dot: 'bg-normal', label: 'Ligado', tone: 'text-normal' };

  if (compact) {
    return (
      <div className="flex items-center gap-2" title={isError ? error?.message : undefined}>
        <span className={`inline-block size-2 rounded-full ${state.dot}`} aria-hidden="true" />
        <span className={`text-xs font-medium ${state.tone}`}>{state.label}</span>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className={`inline-block size-2.5 rounded-full ${state.dot}`} aria-hidden="true" />
        <h2 className="text-sm font-semibold">Servidor: {state.label}</h2>
      </div>

      {data && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-slate-500">Base de dados</dt>
            <dd className="font-medium">{data.database.connected ? 'Ligada' : 'Em baixo'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Versão</dt>
            <dd className="font-medium">{data.database.serverVersion ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Resposta</dt>
            <dd className="font-medium">{data.database.latencyMs} ms</dd>
          </div>
          <div>
            <dt className="text-slate-500">Activo há</dt>
            <dd className="font-medium">{data.uptimeSeconds}s</dd>
          </div>
        </dl>
      )}

      {isError && (
        <p className="mt-3 text-xs text-urgente">
          {error instanceof Error ? error.message : 'Erro desconhecido.'} Verifique se o backend
          está a correr em <code className="font-mono">http://localhost:3001</code>.
        </p>
      )}
    </section>
  );
}
