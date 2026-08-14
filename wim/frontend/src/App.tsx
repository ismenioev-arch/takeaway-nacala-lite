import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { DashboardPage } from '@/pages/DashboardPage';
import { LoginPage } from '@/pages/LoginPage';
import { AttentionPage } from '@/pages/AttentionPage';
import { ConversationsPage } from '@/pages/ConversationsPage';
import { ClientsPage } from '@/pages/ClientsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ProtectedRoute } from '@/components/ProtectedRoute';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/atencao" element={<AttentionPage />} />
        <Route path="/conversas" element={<ConversationsPage />} />
        <Route path="/clientes" element={<ClientsPage />} />
        <Route path="/definicoes" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
