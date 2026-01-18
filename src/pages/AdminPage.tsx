import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Clock, ChefHat, CheckCircle, Truck, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';

const statusOptions = [
  { value: 'pending', label: 'Pendente', icon: Clock },
  { value: 'preparing', label: 'Preparando', icon: ChefHat },
  { value: 'ready', label: 'Pronto', icon: CheckCircle },
  { value: 'delivered', label: 'Entregue', icon: Truck },
];

const AdminPage: React.FC = () => {
  const { isOwnerOrAdmin, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrders = async () => {
      const { data } = await supabase
        .from('orders')
        .select('*, restaurant_tables(number), profiles(full_name)')
        .order('created_at', { ascending: false });
      setOrders(data || []);
      setLoading(false);
    };

    fetchOrders();

    const channel = supabase.channel('admin-orders').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchOrders()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const updateStatus = async (orderId: string, status: string) => {
    await supabase.from('orders').update({ status }).eq('id', orderId);
    toast.success('Status atualizado!');
  };

  const formatPrice = (price: number) => new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', minimumFractionDigits: 0 }).format(price);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (!isOwnerOrAdmin) return <Navigate to="/menu" replace />;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6">
        <Link to="/menu" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft size={20} />
          <span>Voltar ao cardápio</span>
        </Link>

        <h1 className="text-2xl font-display font-bold mb-6">Painel Admin - Pedidos</h1>
        {loading ? <Loader2 className="animate-spin mx-auto" /> : (
          <div className="space-y-4">
            {orders.map((order) => (
              <div key={order.id} className="card-elevated p-4">
                <div className="flex flex-wrap justify-between gap-4 items-start">
                  <div>
                    <p className="font-bold">#{order.id.slice(0, 8).toUpperCase()}</p>
                    <p className="text-sm text-muted-foreground">Mesa {order.restaurant_tables?.number} • {order.profiles?.full_name}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(order.created_at), 'dd/MM HH:mm')}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-primary">{formatPrice(order.total)}</p>
                    <Select value={order.status} onValueChange={(v) => updateStatus(order.id, v)}>
                      <SelectTrigger className="w-40 mt-2"><SelectValue /></SelectTrigger>
                      <SelectContent>{statusOptions.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminPage;
