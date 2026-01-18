import React from 'react';
import { motion } from 'framer-motion';
import { Plus, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/contexts/CartContext';

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_available: boolean;
}

interface MenuItemCardProps {
  item: MenuItem;
}

const MenuItemCard: React.FC<MenuItemCardProps> = ({ item }) => {
  const { items, addItem } = useCart();
  const isInCart = items.some(i => i.menu_item_id === item.id);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-MZ', {
      style: 'currency',
      currency: 'MZN',
      minimumFractionDigits: 0,
    }).format(price);
  };

  const handleAdd = () => {
    addItem({
      menu_item_id: item.id,
      name: item.name,
      price: item.price,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`card-menu-item overflow-hidden ${!item.is_available ? 'opacity-50' : ''}`}
    >
      {item.image_url && (
        <div className="aspect-video bg-muted overflow-hidden">
          <img
            src={item.image_url}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        </div>
      )}
      <div className="p-4">
        <div className="flex justify-between items-start gap-2 mb-2">
          <h3 className="font-semibold text-foreground line-clamp-1">{item.name}</h3>
          <span className="text-primary font-bold whitespace-nowrap">
            {formatPrice(item.price)}
          </span>
        </div>
        {item.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {item.description}
          </p>
        )}
        <Button
          onClick={handleAdd}
          disabled={!item.is_available}
          variant={isInCart ? 'secondary' : 'default'}
          className="w-full gap-2"
          size="sm"
        >
          {isInCart ? (
            <>
              <Check size={16} />
              No carrinho
            </>
          ) : (
            <>
              <Plus size={16} />
              Adicionar
            </>
          )}
        </Button>
      </div>
    </motion.div>
  );
};

export default MenuItemCard;
