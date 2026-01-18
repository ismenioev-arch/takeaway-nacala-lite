import React, { useEffect, useState, useRef } from 'react';
import { Link, useParams, useSearchParams, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Send, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { validateMessage } from '@/lib/validation';

interface Message {
  id: string;
  message: string;
  is_from_admin: boolean;
  created_at: string;
}

const AdminSupportPage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('order');
  const { user, isOwnerOrAdmin, loading: authLoading } = useAuth();
  const [customerName, setCustomerName] = useState('Cliente');
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userId || !isOwnerOrAdmin) return;

    const fetchData = async () => {
      // Fetch customer name
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (profile?.full_name) {
        setCustomerName(profile.full_name);
      }

      // Fetch messages
      const query = supabase
        .from('customer_messages')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (orderId) {
        query.eq('order_id', orderId);
      }

      const { data } = await query;
      setMessages(data || []);
      setLoading(false);

      // Mark messages as read
      if (data && data.length > 0) {
        const unreadIds = data.filter(m => !m.is_from_admin && !m.read_at).map(m => m.id);
        if (unreadIds.length > 0) {
          await supabase
            .from('customer_messages')
            .update({ read_at: new Date().toISOString() })
            .in('id', unreadIds);
        }
      }
    };

    fetchData();

    // Real-time subscription
    const channel = supabase
      .channel(`admin-support-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'customer_messages',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as Message]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, orderId, isOwnerOrAdmin]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!user || !userId) return;

    // Validate message
    const validation = validateMessage(newMessage);
    if (!validation.success) {
      toast.error(validation.error || 'Mensagem inválida');
      return;
    }

    setSending(true);
    try {
      const { error } = await supabase.from('customer_messages').insert({
        user_id: userId,
        order_id: orderId || null,
        message: validation.data!,
        is_from_admin: true,
      });

      if (error) throw error;
      setNewMessage('');
    } catch (error: any) {
      toast.error('Erro ao enviar mensagem');
    } finally {
      setSending(false);
    }
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (!isOwnerOrAdmin) return <Navigate to="/menu" replace />;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-6 flex flex-col">
        <Link to="/admin" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft size={20} /> Voltar ao Painel
        </Link>

        <h1 className="text-2xl font-display font-bold mb-2">Suporte - {customerName}</h1>
        {orderId && (
          <p className="text-muted-foreground mb-6">
            Pedido: {orderId}
          </p>
        )}

        {/* Messages */}
        <div className="flex-1 card-elevated p-4 mb-4 overflow-y-auto max-h-[50vh] space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-primary" size={32} />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>Nenhuma mensagem ainda</p>
            </div>
          ) : (
            messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.is_from_admin ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[80%] p-3 rounded-2xl ${
                  msg.is_from_admin 
                    ? 'bg-primary text-primary-foreground rounded-br-none' 
                    : 'bg-muted rounded-bl-none'
                }`}>
                  <p className="text-sm">{msg.message}</p>
                  <p className={`text-xs mt-1 ${msg.is_from_admin ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {format(new Date(msg.created_at), 'HH:mm')}
                  </p>
                </div>
              </motion.div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <Textarea
              placeholder="Digite sua resposta... (máx. 2000 caracteres)"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value.slice(0, 2000))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={sending}
              className="flex-1 min-h-[60px] max-h-[120px] resize-none"
              rows={2}
            />
            <Button onClick={handleSend} disabled={sending || !newMessage.trim()} className="self-end">
              {sending ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-right">
            {newMessage.length}/2000
          </p>
        </div>
      </main>
    </div>
  );
};

export default AdminSupportPage;
