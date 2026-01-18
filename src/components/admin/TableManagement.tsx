import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Users, QrCode, Clock, CheckCircle } from 'lucide-react';

interface Table {
  id: string;
  number: number;
  capacity: number;
  status: string;
}

interface ActiveOrder {
  table_id: string;
  order_ref: string;
  status: string;
  total: number;
}

const TableManagement: React.FC = () => {
  const [tables, setTables] = useState<Table[]>([]);
  const [activeOrders, setActiveOrders] = useState<Map<string, ActiveOrder>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      // Fetch tables
      const { data: tablesData } = await supabase
        .from('restaurant_tables')
        .select('*')
        .order('number');
      setTables(tablesData || []);

      // Fetch active orders for tables
      const { data: ordersData } = await supabase
        .from('orders')
        .select('table_id, order_ref, status, total')
        .not('table_id', 'is', null)
        .in('status', ['pending', 'preparing', 'ready']);

      const ordersMap = new Map<string, ActiveOrder>();
      ordersData?.forEach(order => {
        if (order.table_id) {
          ordersMap.set(order.table_id, order as ActiveOrder);
        }
      });
      setActiveOrders(ordersMap);
      setLoading(false);
    };

    fetchData();

    // Real-time updates
    const channel = supabase.channel('tables-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_tables' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const updateTableStatus = async (tableId: string, status: string) => {
    await supabase.from('restaurant_tables').update({ status }).eq('id', tableId);
    toast.success('Status da mesa atualizado!');
  };

  const generateQRUrl = (tableNumber: number) => {
    const baseUrl = window.location.origin;
    return `${baseUrl}/mesa/${tableNumber}`;
  };

  const copyQRUrl = (tableNumber: number) => {
    navigator.clipboard.writeText(generateQRUrl(tableNumber));
    toast.success(`Link da Mesa ${tableNumber} copiado!`);
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', minimumFractionDigits: 0 }).format(price);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return 'bg-green-500';
      case 'occupied': return 'bg-red-500';
      case 'reserved': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'available': return 'Disponível';
      case 'occupied': return 'Ocupada';
      case 'reserved': return 'Reservada';
      default: return status;
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Carregando mesas...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Gestão de Mesas</h3>
        <Badge variant="outline">
          {tables.filter(t => t.status === 'available').length} disponíveis
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {tables.map((table) => {
          const activeOrder = activeOrders.get(table.id);
          const isOccupied = activeOrder || table.status === 'occupied';

          return (
            <motion.div
              key={table.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.02 }}
            >
              <Card className={`relative overflow-hidden ${isOccupied ? 'border-primary' : ''}`}>
                <div className={`absolute top-0 left-0 right-0 h-1 ${getStatusColor(isOccupied ? 'occupied' : table.status)}`} />
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="flex items-center justify-between text-lg">
                    <span>Mesa {table.number}</span>
                    <Badge variant="secondary" className="text-xs">
                      <Users size={10} className="mr-1" />
                      {table.capacity}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Badge className={`${getStatusColor(isOccupied ? 'occupied' : table.status)} text-white w-full justify-center`}>
                    {getStatusLabel(isOccupied ? 'occupied' : table.status)}
                  </Badge>

                  {activeOrder && (
                    <div className="text-xs bg-muted p-2 rounded space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{activeOrder.order_ref}</span>
                        <Badge variant="outline" className="text-xs">
                          {activeOrder.status === 'pending' && <Clock size={10} className="mr-1" />}
                          {activeOrder.status === 'ready' && <CheckCircle size={10} className="mr-1" />}
                          {activeOrder.status}
                        </Badge>
                      </div>
                      <p className="text-primary font-medium">{formatPrice(activeOrder.total)}</p>
                    </div>
                  )}

                  <div className="flex gap-1">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="flex-1 text-xs"
                      onClick={() => copyQRUrl(table.number)}
                    >
                      <QrCode size={12} className="mr-1" />
                      QR
                    </Button>
                    {!activeOrder && (
                      <Button
                        size="sm"
                        variant={table.status === 'available' ? 'default' : 'secondary'}
                        className="flex-1 text-xs"
                        onClick={() => updateTableStatus(
                          table.id, 
                          table.status === 'available' ? 'reserved' : 'available'
                        )}
                      >
                        {table.status === 'available' ? 'Reservar' : 'Liberar'}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {tables.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p>Nenhuma mesa cadastrada</p>
        </div>
      )}
    </div>
  );
};

export default TableManagement;
