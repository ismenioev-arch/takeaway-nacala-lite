import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BackendStatus } from '@/components/BackendStatus';
import { useAuth } from '@/hooks/useAuth';

interface NavItem {
  label: string;
  to: string;
  icon: string;
  enabled: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Painel', to: '/', icon: '▦', enabled: true },
  { label: 'Atenção', to: '/atencao', icon: '◉', enabled: true },
  { label: 'Conversas', to: '/conversas', icon: '✉', enabled: true },
  { label: 'Clientes', to: '/clientes', icon: '☺', enabled: true },
  { label: 'Definições', to: '/definicoes', icon: '⚙', enabled: true },
];

function NavItems({ orientation }: { orientation: 'bottom' | 'side' }) {
  const isBottom = orientation === 'bottom';

  return (
    <>
      {NAV_ITEMS.map((item) => {
        const shared = isBottom
          ? 'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]'
          : 'flex items-center gap-3 rounded-lg px-3 py-2 text-sm';

        if (!item.enabled) {
          return (
            <span
              key={item.to}
              aria-disabled="true"
              title="Disponível numa fase seguinte"
              className={`${shared} cursor-not-allowed text-slate-400`}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </span>
          );
        }

        return (
          <NavLink
            key={item.to}
            to={item.to}
            end
            className={({ isActive }) =>
              [
                shared,
                isActive
                  ? 'font-semibold text-slate-900 ' + (isBottom ? '' : 'bg-slate-100')
                  : 'text-slate-600 hover:text-slate-900',
              ].join(' ')
            }
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </>
  );
}

export function AppLayout() {
  const navigate = useNavigate();
  const { session, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    }
  };

  return (
    <div className="safe-area flex min-h-dvh flex-col md:flex-row">
      {/* Barra lateral — apenas em ecrãs grandes */}
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white p-4 md:flex md:flex-col">
        <div className="mb-6 px-3">
          <p className="text-lg font-bold tracking-tight">WIM</p>
          <p className="text-xs text-slate-500">Gestor Inteligente de WhatsApp</p>
        </div>

        <nav className="flex flex-col gap-1">
          <NavItems orientation="side" />
        </nav>

        <div className="mt-auto space-y-3 border-t border-slate-200 pt-4">
          <BackendStatus compact />

          {session && (
            <div className="rounded-lg bg-slate-50 p-3 text-xs">
              <p className="font-medium text-slate-900">{session.user.name}</p>
              <p className="text-slate-600">{session.user.email}</p>
              <button
                onClick={handleLogout}
                className="mt-2 w-full rounded text-left text-slate-600 hover:text-slate-900"
              >
                Sair
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        {/* Cabeçalho — apenas em telemóvel */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <div>
            <p className="text-base font-bold tracking-tight">WIM</p>
            <p className="text-[11px] text-slate-500">Gestor Inteligente de WhatsApp</p>
          </div>
          <div className="flex items-center gap-3">
            <BackendStatus compact />
            {session && (
              <button
                onClick={handleLogout}
                className="text-xs text-slate-600 hover:text-slate-900"
                title={session.user.email}
              >
                ⎋
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 pb-24 md:p-8 md:pb-8">
          <Outlet />
        </main>

        {/* Navegação inferior — apenas em telemóvel */}
        <nav className="fixed inset-x-0 bottom-0 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
          <NavItems orientation="bottom" />
        </nav>
      </div>
    </div>
  );
}
