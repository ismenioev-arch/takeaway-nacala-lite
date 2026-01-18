import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { TrendingUp, TrendingDown, ShoppingBag, Users, Star, CreditCard, Loader2, Calendar, DollarSign } from 'lucide-react';
import { format, subDays, startOfDay, endOfDay, startOfWeek, startOfMonth, eachDayOfInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const COLORS = ['hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(142, 76%, 36%)', 'hsl(48, 96%, 53%)', 'hsl(var(--muted))'];

interface OrderItem {
  menu_item_id: string | null;
  quantity: number;
  unit_price: number;
}

interface Order {
  id: string;
  total: number;
  status: string;
  payment_status: string;
  payment_method: string | null;
  order_type: string;
  created_at: string;
}

interface MenuItem {
  id: string;
  name: string;
}

const SalesReports: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('7d');
  
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalOrders: 0,
    avgOrderValue: 0,
    paidOrders: 0,
    pendingPayments: 0,
    totalCustomers: 0,
    avgRating: 0,
    previousRevenue: 0,
  });

  const [dailyData, setDailyData] = useState<{ date: string; revenue: number; orders: number }[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<{ name: string; value: number }[]>([]);
  const [orderTypes, setOrderTypes] = useState<{ name: string; value: number }[]>([]);
  const [topItems, setTopItems] = useState<{ name: string; quantity: number; revenue: number }[]>([]);

  const fetchData = async () => {
    setLoading(true);
    
    const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const startDate = startOfDay(subDays(new Date(), periodDays));
    const previousStartDate = startOfDay(subDays(startDate, periodDays));

    // Fetch orders for current period
    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .order('created_at');

    // Fetch orders for previous period (for comparison)
    const { data: previousOrders } = await supabase
      .from('orders')
      .select('total')
      .gte('created_at', previousStartDate.toISOString())
      .lt('created_at', startDate.toISOString());

    // Fetch order items for top selling
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('menu_item_id, quantity, unit_price');

    // Fetch menu items
    const { data: menuItems } = await supabase
      .from('menu_items')
      .select('id, name');

    // Fetch users and reviews
    const { data: users } = await supabase.from('profiles').select('id');
    const { data: reviews } = await supabase.from('reviews').select('rating');

    // Calculate stats
    const ordersArr = (orders || []) as Order[];
    const totalRevenue = ordersArr.reduce((sum, o) => sum + Number(o.total), 0);
    const paidOrders = ordersArr.filter(o => o.payment_status === 'paid').length;
    const avgOrderValue = ordersArr.length ? totalRevenue / ordersArr.length : 0;
    const previousRevenue = (previousOrders || []).reduce((sum, o) => sum + Number(o.total), 0);
    const avgRating = reviews?.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;

    setStats({
      totalRevenue,
      totalOrders: ordersArr.length,
      avgOrderValue,
      paidOrders,
      pendingPayments: ordersArr.length - paidOrders,
      totalCustomers: users?.length || 0,
      avgRating: Math.round(avgRating * 10) / 10,
      previousRevenue,
    });

    // Daily data
    const days = eachDayOfInterval({ start: startDate, end: new Date() });
    const dailyStats = days.map(day => {
      const dayOrders = ordersArr.filter(o => {
        const orderDate = new Date(o.created_at);
        return orderDate >= startOfDay(day) && orderDate <= endOfDay(day);
      });
      return {
        date: format(day, 'dd/MM', { locale: ptBR }),
        revenue: dayOrders.reduce((sum, o) => sum + Number(o.total), 0),
        orders: dayOrders.length,
      };
    });
    setDailyData(dailyStats);

    // Payment methods
    const paymentCounts: Record<string, number> = {};
    ordersArr.forEach(o => {
      const method = o.payment_method || 'Não definido';
      paymentCounts[method] = (paymentCounts[method] || 0) + 1;
    });
    setPaymentMethods(Object.entries(paymentCounts).map(([name, value]) => ({ 
      name: name.charAt(0).toUpperCase() + name.slice(1), 
      value 
    })));

    // Order types
    const typeCounts: Record<string, number> = {};
    ordersArr.forEach(o => {
      const type = o.order_type === 'online' ? 'Online' : 'Mesa';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
    setOrderTypes(Object.entries(typeCounts).map(([name, value]) => ({ name, value })));

    // Top selling items
    const itemsMap = new Map<string, MenuItem>();
    (menuItems || []).forEach(item => itemsMap.set(item.id, item));

    const itemSales: Record<string, { quantity: number; revenue: number }> = {};
    (orderItems || []).forEach(item => {
      if (item.menu_item_id) {
        if (!itemSales[item.menu_item_id]) {
          itemSales[item.menu_item_id] = { quantity: 0, revenue: 0 };
        }
        itemSales[item.menu_item_id].quantity += item.quantity;
        itemSales[item.menu_item_id].revenue += item.quantity * Number(item.unit_price);
      }
    });

    const topItemsArr = Object.entries(itemSales)
      .map(([id, data]) => ({
        name: itemsMap.get(id)?.name || 'Item removido',
        quantity: data.quantity,
        revenue: data.revenue,
      }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);
    setTopItems(topItemsArr);

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [period]);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', minimumFractionDigits: 0 }).format(price);

  const revenueChange = stats.previousRevenue > 0 
    ? ((stats.totalRevenue - stats.previousRevenue) / stats.previousRevenue) * 100 
    : 0;

  if (loading) {
    return <div className="text-center py-8"><Loader2 className="animate-spin mx-auto" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Period Selector */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Relatórios de Vendas</h3>
        <Select value={period} onValueChange={(v: '7d' | '30d' | '90d') => setPeriod(v)}>
          <SelectTrigger className="w-40">
            <Calendar size={16} className="mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Últimos 7 dias</SelectItem>
            <SelectItem value="30d">Últimos 30 dias</SelectItem>
            <SelectItem value="90d">Últimos 90 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign size={16} />Receita Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-primary">{formatPrice(stats.totalRevenue)}</p>
            <div className={`flex items-center gap-1 text-xs ${revenueChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {revenueChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              <span>{Math.abs(revenueChange).toFixed(1)}% vs período anterior</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShoppingBag size={16} />Pedidos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.totalOrders}</p>
            <p className="text-xs text-muted-foreground">Média: {formatPrice(stats.avgOrderValue)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CreditCard size={16} />Pagamentos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{stats.paidOrders}</p>
            {stats.pendingPayments > 0 && (
              <Badge variant="secondary" className="text-xs">{stats.pendingPayments} pendentes</Badge>
            )}
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
            <p className="text-xs text-muted-foreground">{stats.totalCustomers} clientes</p>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Receita por Dia</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${v/1000}k`} />
                <Tooltip 
                  formatter={(value: number) => formatPrice(value)}
                  labelStyle={{ color: 'hsl(var(--foreground))' }}
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--background))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                />
                <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Charts Grid */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Payment Methods */}
        <Card>
          <CardHeader>
            <CardTitle>Métodos de Pagamento</CardTitle>
          </CardHeader>
          <CardContent>
            {paymentMethods.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">Sem dados</p>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={paymentMethods}
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {paymentMethods.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Order Types */}
        <Card>
          <CardHeader>
            <CardTitle>Tipo de Pedido</CardTitle>
          </CardHeader>
          <CardContent>
            {orderTypes.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">Sem dados</p>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={orderTypes} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                    <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" width={60} />
                    <Tooltip />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={4} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Selling Items */}
      <Card>
        <CardHeader>
          <CardTitle>Itens Mais Vendidos</CardTitle>
        </CardHeader>
        <CardContent>
          {topItems.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">Sem dados de vendas</p>
          ) : (
            <div className="space-y-3">
              {topItems.map((item, index) => (
                <div key={item.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="w-8 h-8 rounded-full flex items-center justify-center font-bold">
                      {index + 1}
                    </Badge>
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.quantity} vendidos</p>
                    </div>
                  </div>
                  <span className="font-bold text-primary">{formatPrice(item.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SalesReports;
