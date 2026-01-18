import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Loader2, Clock, ChefHat, CheckCircle, Truck, ArrowLeft, 
  ShoppingBag, TrendingUp, Users, Star, MessageCircle, 
  Smartphone, Building, Banknote, CreditCard, LayoutGrid, Bell, BellRing,
  UtensilsCrossed, BarChart3
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import OrderDetailModal from '@/components/admin/OrderDetailModal';
import TableManagement from '@/components/admin/TableManagement';
import MenuManagement from '@/components/admin/MenuManagement';
import SalesReports from '@/components/admin/SalesReports';
import { useNewOrderNotification } from '@/hooks/useNewOrderNotification';
import { Button } from '@/components/ui/button';

const statusOptions = [
  { value: 'pending', label: 'Pendente', icon: Clock, color: 'bg-yellow-500' },
  { value: 'preparing', label: 'Preparando', icon: ChefHat, color: 'bg-blue-500' },
  { value: 'ready', label: 'Pronto', icon: CheckCircle, color: 'bg-green-500' },
  { value: 'delivered', label: 'Entregue', icon: Truck, color: 'bg-gray-500' },
];

const paymentIcons: Record<string, React.ElementType> = {
  mpesa: Smartphone,
  emola: Smartphone,
  bank: Building,
  cash: Banknote,
};

interface Order {
  id: string;
  order_ref: string;
  status: string;
  payment_status: string;
  payment_method: string | null;
  total: number;
  notes: string | null;
  is_urgent: boolean;
  order_type: string;
  created_at: string;
  user_id: string | null;
  restaurant_tables?: { number: number } | null;
  profiles?: { full_name: string | null; phone: string | null } | null;
}

interface Message {
  id: string;
  message: string;
  user_id: string;
  order_id: string | null;
  created_at: string;
  profiles?: { full_name: string | null } | null;
}

const AdminDashboard: React.FC = () => {
  const { isOwnerOrAdmin, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [activeTab, setActiveTab] = useState('orders');
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalRevenue: 0,
    totalUsers: 0,
    avgRating: 0,
    pendingOrders: 0,
    todayOrders: 0,
    paymentMethods: {} as Record<string, number>,
  });
  const [loading, setLoading] = useState(true);

  // Enable sound notifications for new orders
  useNewOrderNotification(notificationsEnabled);

  const fetchData = async () => {
    // Fetch orders with details
    const { data: ordersData } = await supabase
      .from('orders')
      .select('*, restaurant_tables(number)')
      .order('created_at', { ascending: false });
    
    // Fetch profiles for orders
    const userIds = ordersData?.map(o => o.user_id).filter(Boolean) || [];
    let profilesMap: Record<string, { full_name: string | null; phone: string | null }> = {};
    
    if (userIds.length > 0) {
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('user_id, full_name, phone')
        .in('user_id', userIds);
      profilesData?.forEach(p => {
        profilesMap[p.user_id] = { full_name: p.full_name, phone: p.phone };
      });
    }

    const enrichedOrders = (ordersData || []).map(order => ({
      ...order,
      profiles: order.user_id ? profilesMap[order.user_id] || null : null,
    })) as Order[];
    setOrders(enrichedOrders);

    // Fetch unread messages
    const { data: messagesData } = await supabase
      .from('customer_messages')
      .select('*')
      .is('read_at', null)
      .eq('is_from_admin', false)
      .order('created_at', { ascending: false })
      .limit(20);
    
    // Fetch profiles for messages
    const msgUserIds = messagesData?.map(m => m.user_id).filter(Boolean) || [];
    let msgProfilesMap: Record<string, { full_name: string | null }> = {};
    
    if (msgUserIds.length > 0) {
      const { data: msgProfilesData } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', msgUserIds);
      msgProfilesData?.forEach(p => {
        msgProfilesMap[p.user_id] = { full_name: p.full_name };
      });
    }

    const enrichedMessages = (messagesData || []).map(msg => ({
      ...msg,
      profiles: msgProfilesMap[msg.user_id] || null,
    })) as Message[];
    setMessages(enrichedMessages);

    // Calculate stats
    const today = new Date().toISOString().split('T')[0];
    const todayOrders = ordersData?.filter(o => o.created_at.startsWith(today)) || [];
    const pendingOrders = ordersData?.filter(o => ['pending', 'preparing'].includes(o.status)) || [];
    
    const paymentMethods: Record<string, number> = {};
    ordersData?.forEach(o => {
      if (o.payment_method) {
        paymentMethods[o.payment_method] = (paymentMethods[o.payment_method] || 0) + 1;
      }
    });

    const { data: users } = await supabase.from('profiles').select('id');
    const { data: reviews } = await supabase.from('reviews').select('rating');

    const totalRevenue = ordersData?.reduce((sum, o) => sum + Number(o.total), 0) || 0;
    const avgRating = reviews?.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;

    setStats({
      totalOrders: ordersData?.length || 0,
      totalRevenue,
      totalUsers: users?.length || 0,
      avgRating: Math.round(avgRating * 10) / 10,
      pendingOrders: pendingOrders.length,
      todayOrders: todayOrders.length,
      paymentMethods,
    });

    setLoading(false);
  };

  useEffect(() => {
    fetchData();

    // Real-time subscriptions
    const ordersChannel = supabase.channel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchData())
      .subscribe();

    const messagesChannel = supabase.channel('admin-messages')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_messages' }, () => fetchData())
      .subscribe();

    return () => {
      supabase.removeChannel(ordersChannel);
      supabase.removeChannel(messagesChannel);
    };
  }, []);

  const markMessageRead = async (messageId: string) => {
    await supabase.from('customer_messages').update({ read_at: new Date().toISOString() }).eq('id', messageId);
  };

  const formatPrice = (price: number) => 
    new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', minimumFractionDigits: 0 }).format(price);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (!isOwnerOrAdmin) return <Navigate to="/menu" replace />;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <Link to="/menu" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={20} />
            <span>Voltar ao cardápio</span>
          </Link>
          <Button
            variant={notificationsEnabled ? "default" : "outline"}
            size="sm"
            onClick={() => setNotificationsEnabled(!notificationsEnabled)}
            className="gap-2"
          >
            {notificationsEnabled ? <BellRing size={16} /> : <Bell size={16} />}
            {notificationsEnabled ? 'Notificações ON' : 'Notificações OFF'}
          </Button>
        </div>

        <h1 className="text-2xl font-display font-bold mb-6">Painel Administrativo</h1>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ShoppingBag size={16} />Pedidos Hoje
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.todayOrders}</p>
            </CardContent>
          </Card>
          <Card className="border-warning/50 bg-warning/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-warning flex items-center gap-2">
                <Clock size={16} />Pendentes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-warning">{stats.pendingOrders}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp size={16} />Receita Total
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-primary">{formatPrice(stats.totalRevenue)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Star size={16} />Avaliação
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.avgRating || '—'} ⭐</p>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="orders">Pedidos</TabsTrigger>
            <TabsTrigger value="tables">
              <LayoutGrid size={14} className="mr-1" />
              Mesas
            </TabsTrigger>
            <TabsTrigger value="menu">
              <UtensilsCrossed size={14} className="mr-1" />
              Menu
            </TabsTrigger>
            <TabsTrigger value="messages" className="relative">
              Mensagens
              {messages.length > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 text-xs">
                  {messages.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="reports">
              <BarChart3 size={14} className="mr-1" />
              Relatórios
            </TabsTrigger>
            <TabsTrigger value="customers">
              <Users size={14} className="mr-1" />
              Clientes
            </TabsTrigger>
          </TabsList>

          {/* Orders Tab */}
          <TabsContent value="orders" className="space-y-4">
            {loading ? (
              <Loader2 className="animate-spin mx-auto" />
            ) : orders.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ShoppingBag className="mx-auto mb-4" size={48} />
                <p>Nenhum pedido ainda</p>
              </div>
            ) : (
              orders.map((order) => {
                const PaymentIcon = paymentIcons[order.payment_method || ''] || CreditCard;
                const statusConfig = statusOptions.find(s => s.value === order.status);
                const StatusIcon = statusConfig?.icon || Clock;

                return (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ scale: 1.01 }}
                    onClick={() => setSelectedOrder(order)}
                    className="card-elevated p-4 cursor-pointer hover:border-primary/50 transition-colors"
                  >
                    <div className="flex flex-wrap justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-bold">{order.order_ref}</p>
                          {order.is_urgent && (
                            <Badge variant="destructive" className="text-xs">Urgente</Badge>
                          )}
                          <Badge className={`${statusConfig?.color} text-white text-xs`}>
                            <StatusIcon size={12} className="mr-1" />
                            {statusConfig?.label}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {order.order_type === 'online' ? '🌐 Online' : `🪑 Mesa ${order.restaurant_tables?.number}`}
                          {' • '}{order.profiles?.full_name || 'Anônimo'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(order.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                      <div className="text-right space-y-1">
                        <p className="font-bold text-primary text-lg">{formatPrice(order.total)}</p>
                        <div className="flex items-center justify-end gap-2">
                          <PaymentIcon size={14} className="text-muted-foreground" />
                          <span className="text-xs capitalize">{order.payment_method || 'N/A'}</span>
                          <Badge variant={order.payment_status === 'paid' ? 'default' : 'secondary'} className="text-xs">
                            {order.payment_status === 'paid' ? 'Pago' : 'Pendente'}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
          </TabsContent>

          {/* Tables Tab */}
          <TabsContent value="tables">
            <TableManagement />
          </TabsContent>

          {/* Menu Tab */}
          <TabsContent value="menu">
            <MenuManagement />
          </TabsContent>

          {/* Messages Tab */}
          <TabsContent value="messages" className="space-y-4">
            {messages.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <MessageCircle className="mx-auto mb-4" size={48} />
                <p>Nenhuma mensagem pendente</p>
              </div>
            ) : (
              messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="card-elevated p-4"
                  onClick={() => markMessageRead(msg.id)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-bold">{msg.profiles?.full_name || 'Cliente'}</p>
                      <p className="text-muted-foreground">{msg.message}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {format(new Date(msg.created_at), "dd/MM 'às' HH:mm")}
                      </p>
                    </div>
                    <Link to={`/admin/support/${msg.user_id}${msg.order_id ? `?order=${msg.order_id}` : ''}`}>
                      <Button size="sm" variant="outline">Responder</Button>
                    </Link>
                  </div>
                </motion.div>
              ))
            )}
          </TabsContent>

          {/* Reports Tab */}
          <TabsContent value="reports">
            <SalesReports />
          </TabsContent>

          {/* Customers Tab */}
          <TabsContent value="customers" className="space-y-4">
            <CustomersTab />
          </TabsContent>
        </Tabs>
      </main>

      {/* Order Detail Modal */}
      <OrderDetailModal
        order={selectedOrder}
        open={!!selectedOrder}
        onOpenChange={(open) => !open && setSelectedOrder(null)}
        onStatusChange={fetchData}
      />
    </div>
  );
};

// Customers Tab Component
const CustomersTab: React.FC = () => {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCustomers = async () => {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      // Get order stats for each customer
      const { data: orders } = await supabase
        .from('orders')
        .select('user_id, total');

      const orderStats: Record<string, { count: number; total: number }> = {};
      orders?.forEach(o => {
        if (o.user_id) {
          if (!orderStats[o.user_id]) {
            orderStats[o.user_id] = { count: 0, total: 0 };
          }
          orderStats[o.user_id].count++;
          orderStats[o.user_id].total += Number(o.total);
        }
      });

      const enrichedProfiles = (profiles || []).map(p => ({
        ...p,
        orderCount: orderStats[p.user_id]?.count || 0,
        totalSpent: orderStats[p.user_id]?.total || 0,
      }));

      setCustomers(enrichedProfiles);
      setLoading(false);
    };

    fetchCustomers();
  }, []);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', minimumFractionDigits: 0 }).format(price);

  if (loading) {
    return <div className="text-center py-8"><Loader2 className="animate-spin mx-auto" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Clientes ({customers.length})</h3>
      </div>

      {customers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="mx-auto mb-4" size={48} />
          <p>Nenhum cliente cadastrado</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {customers.map((customer) => (
            <motion.div
              key={customer.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="card-elevated p-4"
            >
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-bold">{customer.full_name || 'Sem nome'}</p>
                  <p className="text-sm text-muted-foreground">{customer.phone || 'Sem telefone'}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cliente desde {format(new Date(customer.created_at), 'dd/MM/yyyy', { locale: ptBR })}
                  </p>
                </div>
                <div className="text-right">
                  <Badge variant="outline" className="mb-1">{customer.orderCount} pedidos</Badge>
                  <p className="text-sm font-bold text-primary">{formatPrice(customer.totalSpent)}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
