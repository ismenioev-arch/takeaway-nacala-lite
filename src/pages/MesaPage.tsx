import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

const MesaPage: React.FC = () => {
  const { tableNumber } = useParams<{ tableNumber: string }>();
  const navigate = useNavigate();
  const { setSelectedTable } = useCart();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeTable = async () => {
      if (!tableNumber) {
        setError('Número da mesa inválido');
        setLoading(false);
        return;
      }

      const tableNum = parseInt(tableNumber, 10);
      if (isNaN(tableNum)) {
        setError('Número da mesa inválido');
        setLoading(false);
        return;
      }

      // Check if table exists
      const { data: table, error: tableError } = await supabase
        .from('restaurant_tables')
        .select('id, number, status')
        .eq('number', tableNum)
        .maybeSingle();

      if (tableError || !table) {
        setError('Mesa não encontrada');
        setLoading(false);
        return;
      }

      // Set the table in cart context
      setSelectedTable(tableNum);

      // If user is logged in, go to menu, otherwise go to auth
      if (!authLoading) {
        if (user) {
          navigate('/menu', { replace: true });
        } else {
          navigate('/auth?redirect=/menu', { replace: true });
        }
      }
    };

    if (!authLoading) {
      initializeTable();
    }
  }, [tableNumber, user, authLoading, navigate, setSelectedTable]);

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary mb-4" size={48} />
        <p className="text-muted-foreground">Carregando mesa {tableNumber}...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <p className="text-destructive text-xl font-bold mb-4">{error}</p>
        <button onClick={() => navigate('/')} className="btn-primary">
          Voltar ao Início
        </button>
      </div>
    );
  }

  return null;
};

export default MesaPage;
