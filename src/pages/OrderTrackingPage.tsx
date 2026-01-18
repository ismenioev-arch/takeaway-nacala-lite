import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Clock, ChefHat, CheckCircle, Truck, MessageCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const statusSteps = [
  { status: 'pending', label: 'Recebido', icon: Clock, color: 'text-warning' },
  { status: 'preparing', label: 'Preparando', icon: ChefHat, color: 'text-primary' },
  { status: 'ready', label: 'Pronto', icon: CheckCircle, color: 'text-success' },
  { status: 'delivered', label: 'Entregue', icon: Truck, color: 'text-muted-foreground' },
];

const OrderTrackingPage: React.FC = () => {
  const { orderRef } = useParams<{ orderRef: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [order, setOrder] = useState<any>(null);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderRef) return;

    const fetchOrder = async () => {
      // Fetch by order_ref instead of id
      const { data: orderData, error } = await supabase
        .from('orders')
        .select('*, restaurant_tables(number)')
        .eq('order_ref', orderRef)
        .maybeSingle();

      if (error || !orderData) {
        setLoading(false);
        return;
      }

      setOrder(orderData);

      const { data: items } = await supabase
        .from('order_items')
        .select('*, menu_items(name)')
        .eq('order_id', orderData.id);

      setOrderItems(items || []);
      setLoading(false);
    };

    fetchOrder();

    // Real-time subscription using order_ref
    const channel = supabase
      .channel(`order-${orderRef}`)
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'orders',
      }, async (payload) => {
        // Check if this update is for our order
        if (payload.new && (payload.new as any).order_ref === orderRef) {
          setOrder((prev: any) => ({ ...prev, ...payload.new }));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderRef]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', minimumFractionDigits: 0 }).format(price);
  };

  const getCurrentStepIndex = () => {
    return statusSteps.findIndex(step => step.status === order?.status) || 0;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" size={48} />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <p className="text-destructive text-xl font-bold mb-4">Pedido não encontrado</p>
        <Link to="/orders">
          <Button>Ver Meus Pedidos</Button>
        </Link>
      </div>
    );
  }

  const currentStep = getCurrentStepIndex();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6">
        <Link to="/orders" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft size={20} /> Meus Pedidos
        </Link>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-display font-bold mb-2">
            Pedido {order.order_ref}
          </h1>
          <p className="text-muted-foreground">
            {format(new Date(order.created_at), "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
          </p>
        </div>

        {/* Urgent Badge */}
        {order.is_urgent && (
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex items-center justify-center gap-2 bg-warning/20 text-warning rounded-full px-4 py-2 mx-auto w-fit mb-6"
          >
            <AlertTriangle size={18} />
            <span className="font-semibold">Pedido Urgente</span>
          </motion.div>
        )}

        {/* Status Progress */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card-elevated p-6 mb-6"
        >
          <div className="flex justify-between relative">
            {/* Progress line */}
            <div className="absolute top-6 left-0 right-0 h-1 bg-muted -z-10">
              <div 
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${(currentStep / (statusSteps.length - 1)) * 100}%` }}
              />
            </div>

            {statusSteps.map((step, index) => {
              const isActive = index <= currentStep;
              const isCurrent = index === currentStep;
              const StepIcon = step.icon;

              return (
                <div key={step.status} className="flex flex-col items-center z-10">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: index * 0.1 }}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${
                      isCurrent 
                        ? 'bg-primary text-primary-foreground ring-4 ring-primary/30' 
                        : isActive 
                          ? 'bg-primary text-primary-foreground' 
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <StepIcon size={20} />
                  </motion.div>
                  <span className={`text-xs mt-2 text-center ${isActive ? 'font-semibold' : 'text-muted-foreground'}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* ETA */}
          {order.estimated_delivery_time && order.status !== 'delivered' && (
            <div className="text-center mt-6 p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Tempo estimado</p>
              <p className="text-xl font-bold text-primary">
                {formatDistanceToNow(new Date(order.estimated_delivery_time), { locale: ptBR, addSuffix: true })}
              </p>
            </div>
          )}
        </motion.div>

        {/* Order Details */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="card-elevated p-6 mb-6"
        >
          <h2 className="font-bold mb-4">Itens do Pedido</h2>
          <div className="space-y-3">
            {orderItems.map((item) => (
              <div key={item.id} className="flex justify-between items-center">
                <div>
                  <p className="font-medium">{item.quantity}x {item.menu_items?.name}</p>
                  {item.notes && <p className="text-sm text-muted-foreground">{item.notes}</p>}
                </div>
                <p>{formatPrice(item.unit_price * item.quantity)}</p>
              </div>
            ))}
          </div>
          <div className="border-t mt-4 pt-4 flex justify-between font-bold text-lg">
            <span>Total</span>
            <span className="text-primary">{formatPrice(order.total)}</span>
          </div>
        </motion.div>

        {/* Payment Info */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="card-elevated p-6 mb-6"
        >
          <h2 className="font-bold mb-3">Pagamento</h2>
          <div className="flex justify-between items-center">
            <span className="capitalize">{order.payment_method?.replace('_', ' ')}</span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              order.payment_status === 'paid' 
                ? 'bg-success/20 text-success' 
                : 'bg-warning/20 text-warning'
            }`}>
              {order.payment_status === 'paid' ? 'Pago' : 'Pendente'}
            </span>
          </div>
        </motion.div>

        {/* Support Button */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Link to={`/support?order=${order.order_ref}`}>
            <Button variant="outline" className="w-full gap-2">
              <MessageCircle size={20} />
              Precisa de Ajuda?
            </Button>
          </Link>
        </motion.div>
      </main>
    </div>
  );
};

export default OrderTrackingPage;
