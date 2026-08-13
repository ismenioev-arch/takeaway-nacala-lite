import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { DashboardPage } from '@/pages/DashboardPage';

/**
 * FASE 1: só existe o painel, e serve para confirmar que frontend e backend
 * se falam. Os restantes ecrãs (Atenção, Conversas, Clientes, Métricas,
 * Definições) chegam nas fases 5 e seguintes.
 */
export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
