import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Clock, ChefHat, CheckCircle, Truck, Users, ShoppingBag, Star, TrendingUp, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';

const statusOptions = [
  { value: 'pending', label: 'Pendente', icon: Clock },
  { value: 'preparing', label: 'Preparando', icon: ChefHat },
  { value: 'ready', label: 'Pronto', icon: CheckCircle },
  { value: 'delivered', label: 'Entregue', icon: Truck },
];

const OwnerDashboard: React.FC = () => {
  const { isOwner, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalOrders: 0, totalRevenue: 0, totalUsers: 0, avgRating: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      // Fetch orders
      const { data: ordersData } = await supabase
        .from('orders')
        .select('*, restaurant_tables(number), profiles(full_name)')
        .order('created_at', { ascending: false })
        .limit(20);
      setOrders(ordersData || []);

      // Fetch stats
      const { data: allOrders } = await supabase.from('orders').select('total');
      const { data: users } = await supabase.from('profiles').select('id');
      const { data: reviews } = await supabase.from('reviews').select('rating');

      const totalRevenue = allOrders?.reduce((sum, o) => sum + Number(o.total), 0) || 0;
      const avgRating = reviews?.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;

      setStats({
        totalOrders: allOrders?.length || 0,
        totalRevenue,
        totalUsers: users?.length || 0,
        avgRating: Math.round(avgRating * 10) / 10,
      });

      setLoading(false);
    };

    fetchData();

    const channel = supabase.channel('owner-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const updateStatus = async (orderId: string, status: string) => {
    await supabase.from('orders').update({ status }).eq('id', orderId);
    toast.success('Status atualizado!');
  };

  const formatPrice = (price: number) => new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', minimumFractionDigits: 0 }).format(price);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (!isOwner) return <Navigate to="/menu" replace />;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6">
        <Link to="/menu" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft size={20} />
          <span>Voltar ao cardápio</span>
        </Link>

        <h1 className="text-2xl font-display font-bold mb-6">Painel do Proprietário</h1>
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><ShoppingBag size={16} />Pedidos</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{stats.totalOrders}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><TrendingUp size={16} />Receita</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-primary">{formatPrice(stats.totalRevenue)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Users size={16} />Clientes</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{stats.totalUsers}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Star size={16} />Avaliação</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{stats.avgRating || '—'}</p></CardContent>
          </Card>
        </div>

        {/* Orders */}
        <h2 className="text-xl font-bold mb-4">Pedidos Recentes</h2>
        {loading ? <Loader2 className="animate-spin mx-auto" /> : (
          <div className="space-y-4">
            {orders.map((order) => (
              <div key={order.id} className="card-elevated p-4">
                <div className="flex flex-wrap justify-between gap-4 items-start">
                  <div>
                    <p className="font-bold">#{order.id.slice(0, 8).toUpperCase()}</p>
                    <p className="text-sm text-muted-foreground">
                      {order.order_type === 'online' ? '🌐 Online' : `🪑 Mesa ${order.restaurant_tables?.number}`} • {order.profiles?.full_name}
                    </p>
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

export default OwnerDashboard;
