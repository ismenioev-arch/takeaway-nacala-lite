import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  Clock, ChefHat, CheckCircle, Truck, Send, Loader2,
  MapPin, User, Phone, Package, MessageCircle, CreditCard, AlertTriangle
} from 'lucide-react';

interface OrderItem {
  id: string;
  quantity: number;
  unit_price: number;
  notes: string | null;
  menu_items?: { name: string; image_url: string | null } | null;
}

interface Message {
  id: string;
  message: string;
  is_from_admin: boolean;
  created_at: string;
}

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

interface Props {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange: () => void;
}

const statusOptions = [
  { value: 'pending', label: 'Pendente', icon: Clock, color: 'bg-yellow-500' },
  { value: 'preparing', label: 'Preparando', icon: ChefHat, color: 'bg-blue-500' },
  { value: 'ready', label: 'Pronto', icon: CheckCircle, color: 'bg-green-500' },
  { value: 'delivered', label: 'Entregue', icon: Truck, color: 'bg-gray-500' },
];

const OrderDetailModal: React.FC<Props> = ({ order, open, onOpenChange, onStatusChange }) => {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!order || !open) return;

    const fetchData = async () => {
      setLoading(true);
      
      // Fetch order items with menu item names
      const { data: itemsData } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', order.id);
      
      // Fetch menu items for the order items
      const menuItemIds = itemsData?.map(i => i.menu_item_id).filter(Boolean) || [];
      let menuItemsMap: Record<string, { name: string; image_url: string | null }> = {};
      
      if (menuItemIds.length > 0) {
        const { data: menuData } = await supabase
          .from('menu_items')
          .select('id, name, image_url')
          .in('id', menuItemIds);
        menuData?.forEach(m => {
          menuItemsMap[m.id] = { name: m.name, image_url: m.image_url };
        });
      }

      const enrichedItems = (itemsData || []).map(item => ({
        ...item,
        menu_items: item.menu_item_id ? menuItemsMap[item.menu_item_id] || null : null,
      }));
      setItems(enrichedItems);

      // Fetch messages if user exists
      if (order.user_id) {
        const { data: messagesData } = await supabase
          .from('customer_messages')
          .select('*')
          .eq('user_id', order.user_id)
          .eq('order_id', order.id)
          .order('created_at', { ascending: true });
        setMessages(messagesData || []);
      }

      setLoading(false);
    };

    fetchData();

    // Real-time messages
    if (order.user_id) {
      const channel = supabase
        .channel(`order-messages-${order.id}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'customer_messages',
          filter: `order_id=eq.${order.id}`,
        }, (payload) => {
          setMessages(prev => [...prev, payload.new as Message]);
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [order, open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const updateStatus = async (status: string) => {
    if (!order) return;
    const updates: Record<string, unknown> = { status };
    if (status === 'delivered') {
      updates.estimated_delivery_time = new Date().toISOString();
    }
    await supabase.from('orders').update(updates).eq('id', order.id);
    toast.success('Status atualizado!');
    onStatusChange();
  };

  const updatePaymentStatus = async (paymentStatus: string) => {
    if (!order) return;
    await supabase.from('orders').update({ payment_status: paymentStatus }).eq('id', order.id);
    toast.success('Pagamento atualizado!');
    onStatusChange();
  };

  const sendMessage = async () => {
    if (!order?.user_id || !newMessage.trim()) return;
    setSending(true);
    try {
      await supabase.from('customer_messages').insert({
        user_id: order.user_id,
        order_id: order.id,
        message: newMessage.trim(),
        is_from_admin: true,
      });
      setNewMessage('');
    } catch {
      toast.error('Erro ao enviar mensagem');
    } finally {
      setSending(false);
    }
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', minimumFractionDigits: 0 }).format(price);

  if (!order) return null;

  const statusConfig = statusOptions.find(s => s.value === order.status);
  const StatusIcon = statusConfig?.icon || Clock;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="text-xl">{order.order_ref}</span>
            {order.is_urgent && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle size={12} /> Urgente
              </Badge>
            )}
            <Badge className={`${statusConfig?.color} text-white`}>
              <StatusIcon size={14} className="mr-1" />
              {statusConfig?.label}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6">
            {/* Customer Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <User size={16} className="text-muted-foreground" />
                  <span>{order.profiles?.full_name || 'Anônimo'}</span>
                </div>
                {order.profiles?.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone size={16} className="text-muted-foreground" />
                    <span>{order.profiles.phone}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <MapPin size={16} className="text-muted-foreground" />
                  <span>
                    {order.order_type === 'online' ? 'Pedido Online' : `Mesa ${order.restaurant_tables?.number}`}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Clock size={16} className="text-muted-foreground" />
                  <span>{format(new Date(order.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CreditCard size={16} className="text-muted-foreground" />
                  <span className="capitalize">{order.payment_method || 'Não definido'}</span>
                  <Badge variant={order.payment_status === 'paid' ? 'default' : 'secondary'}>
                    {order.payment_status === 'paid' ? 'Pago' : 'Pendente'}
                  </Badge>
                </div>
              </div>
            </div>

            <Separator />

            {/* Order Items */}
            <div>
              <h3 className="font-semibold flex items-center gap-2 mb-3">
                <Package size={18} /> Itens do Pedido
              </h3>
              {loading ? (
                <Loader2 className="animate-spin mx-auto" />
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <div key={item.id} className="flex justify-between items-center p-2 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        {item.menu_items?.image_url && (
                          <img 
                            src={item.menu_items.image_url} 
                            alt={item.menu_items.name} 
                            className="w-10 h-10 rounded object-cover"
                          />
                        )}
                        <div>
                          <p className="font-medium">{item.quantity}x {item.menu_items?.name}</p>
                          {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
                        </div>
                      </div>
                      <p className="font-medium">{formatPrice(item.unit_price * item.quantity)}</p>
                    </div>
                  ))}
                  <div className="flex justify-between items-center pt-2 border-t">
                    <p className="font-bold">Total</p>
                    <p className="font-bold text-primary text-lg">{formatPrice(order.total)}</p>
                  </div>
                </div>
              )}
              {order.notes && (
                <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">Observações:</p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">{order.notes}</p>
                </div>
              )}
            </div>

            <Separator />

            {/* Status Controls */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Status do Pedido</label>
                <Select value={order.status} onValueChange={updateStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        <div className="flex items-center gap-2">
                          <s.icon size={14} />
                          {s.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Status do Pagamento</label>
                <Select value={order.payment_status} onValueChange={updatePaymentStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pendente</SelectItem>
                    <SelectItem value="paid">Pago</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Chat Section */}
            {order.user_id && (
              <>
                <Separator />
                <div>
                  <h3 className="font-semibold flex items-center gap-2 mb-3">
                    <MessageCircle size={18} /> Mensagens do Cliente
                  </h3>
                  <div className="bg-muted/30 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                    {messages.length === 0 ? (
                      <p className="text-center text-muted-foreground text-sm py-4">Nenhuma mensagem</p>
                    ) : (
                      messages.map((msg) => (
                        <motion.div
                          key={msg.id}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`flex ${msg.is_from_admin ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`max-w-[80%] p-2 rounded-lg text-sm ${
                            msg.is_from_admin 
                              ? 'bg-primary text-primary-foreground' 
                              : 'bg-background border'
                          }`}>
                            <p>{msg.message}</p>
                            <p className={`text-xs mt-1 ${msg.is_from_admin ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                              {format(new Date(msg.created_at), 'HH:mm')}
                            </p>
                          </div>
                        </motion.div>
                      ))
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Textarea
                      placeholder="Responder ao cliente..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      className="min-h-[40px] resize-none"
                      rows={1}
                    />
                    <Button onClick={sendMessage} disabled={sending || !newMessage.trim()} size="icon">
                      {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default OrderDetailModal;
