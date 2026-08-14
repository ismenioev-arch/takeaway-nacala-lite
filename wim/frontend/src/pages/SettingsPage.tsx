import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export function SettingsPage() {
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

  if (!session) {
    return null;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">Definições</h1>
        <p className="mt-1 text-sm text-slate-500">Gerencie as suas preferências.</p>
      </header>

      <section className="space-y-6">
        {/* Informações do utilizador */}
        <div className="rounded-lg border border-slate-200 p-4">
          <h2 className="font-semibold text-slate-900">Perfil</h2>
          <div className="mt-4 space-y-2 text-sm">
            <div>
              <p className="text-slate-600">Nome</p>
              <p className="font-medium text-slate-900">{session.user.name}</p>
            </div>
            <div>
              <p className="text-slate-600">E-mail</p>
              <p className="font-medium text-slate-900">{session.user.email}</p>
            </div>
            <div>
              <p className="text-slate-600">Papel</p>
              <p className="font-medium text-slate-900">{session.user.role}</p>
            </div>
          </div>
        </div>

        {/* Logout */}
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="font-semibold text-red-900">Sessão</h2>
          <p className="mt-2 text-sm text-red-800">
            Fizer logout aqui terminará a sua sessão neste navegador.
          </p>
          <button
            onClick={handleLogout}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Fazer logout
          </button>
        </div>

        {/* Mudança de password */}
        <div className="rounded-lg border border-slate-200 p-4">
          <h2 className="font-semibold text-slate-900">Password</h2>
          <p className="mt-1 text-sm text-slate-600">
            A mudança de password está a ser desenvolvida.
          </p>
          <button
            disabled
            className="mt-4 rounded-lg bg-slate-300 px-4 py-2 text-sm font-medium text-slate-600"
          >
            Mudar password
          </button>
        </div>
      </section>
    </div>
  );
}
