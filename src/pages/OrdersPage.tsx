import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import OrderCard from '@/components/orders/OrderCard';
import ReviewForm from '@/components/reviews/ReviewForm';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, ArrowLeft } from 'lucide-react';

const OrdersPage: React.FC = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewOrder, setReviewOrder] = useState<any>(null);

  useEffect(() => {
    if (!user) return;

    const fetchOrders = async () => {
      const { data } = await supabase
        .from('orders')
        .select('*, restaurant_tables(number)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setOrders(data || []);
      setLoading(false);
    };

    fetchOrders();

    const channel = supabase.channel('orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `user_id=eq.${user.id}` }, () => fetchOrders())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const handleReview = async (rating: number, comment: string) => {
    if (!reviewOrder || !user) return;
    await supabase.from('reviews').insert({ order_id: reviewOrder.id, user_id: user.id, rating, comment });
    toast.success('Obrigado pela sua avaliação!');
    setReviewOrder(null);
  };

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="animate-spin text-primary" size={40} /></div>;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6">
        <Link to="/menu" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft size={20} />
          <span>Voltar ao cardápio</span>
        </Link>

        <h1 className="text-2xl font-display font-bold mb-6">Meus Pedidos</h1>
        <div className="grid gap-4">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={{ ...order, table_number: order.restaurant_tables?.number }}
              onClick={() => order.status === 'delivered' && setReviewOrder(order)}
            />
          ))}
          {orders.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhum pedido encontrado</p>}
        </div>
      </main>
      <Dialog open={!!reviewOrder} onOpenChange={() => setReviewOrder(null)}>
        <DialogContent><DialogHeader><DialogTitle>Avaliar Pedido</DialogTitle></DialogHeader><ReviewForm onSubmit={handleReview} /></DialogContent>
      </Dialog>
    </div>
  );
};

export default OrdersPage;
