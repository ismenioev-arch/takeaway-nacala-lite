import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Clock, CheckCircle, ChefHat, Truck, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

interface Order {
  id: string;
  order_ref: string;
  status: 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled';
  total: number;
  created_at: string;
  table_number?: number;
  notes?: string;
}

interface OrderCardProps {
  order: Order;
  onClick?: () => void;
}

const statusConfig = {
  pending: {
    icon: Clock,
    label: 'Pendente',
    className: 'badge-pending',
  },
  preparing: {
    icon: ChefHat,
    label: 'Preparando',
    className: 'badge-preparing',
  },
  ready: {
    icon: CheckCircle,
    label: 'Pronto',
    className: 'badge-ready',
  },
  delivered: {
    icon: Truck,
    label: 'Entregue',
    className: 'badge-delivered',
  },
  cancelled: {
    icon: XCircle,
    label: 'Cancelado',
    className: 'bg-destructive/20 text-destructive',
  },
};

const OrderCard: React.FC<OrderCardProps> = ({ order, onClick }) => {
  const navigate = useNavigate();
  const config = statusConfig[order.status];
  const Icon = config.icon;

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-MZ', {
      style: 'currency',
      currency: 'MZN',
      minimumFractionDigits: 0,
    }).format(price);
  };

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate(`/pedido/${order.order_ref}`);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      onClick={handleClick}
      className="card-elevated p-4 cursor-pointer"
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Pedido {order.order_ref}
          </p>
          <p className="text-xs text-muted-foreground">
            {format(new Date(order.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: pt })}
          </p>
        </div>
        <span className={`badge-status ${config.className} flex items-center gap-1`}>
          <Icon size={12} />
          {config.label}
        </span>
      </div>

      {order.table_number && (
        <p className="text-sm text-muted-foreground mb-2">
          Mesa {order.table_number}
        </p>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <span className="text-sm text-muted-foreground">Total</span>
        <span className="text-lg font-bold text-primary">{formatPrice(order.total)}</span>
      </div>
    </motion.div>
  );
};

export default OrderCard;
