import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useCart } from '@/contexts/CartContext';
import Header from '@/components/layout/Header';
import MenuItemCard from '@/components/menu/MenuItemCard';
import CategoryTabs from '@/components/menu/CategoryTabs';
import { Button } from '@/components/ui/button';
import { Loader2, ShoppingCart, Truck, ArrowLeft } from 'lucide-react';

const ClientOnlinePage: React.FC = () => {
  const { itemCount, total } = useCart();
  const navigate = useNavigate();
  
  const [categories, setCategories] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMenu = async () => {
      const { data: cats } = await supabase
        .from('menu_categories')
        .select('*')
        .order('display_order');
      
      const { data: menuItems } = await supabase
        .from('menu_items')
        .select('*')
        .eq('is_available', true);

      setCategories(cats || []);
      setItems(menuItems || []);
      if (cats && cats.length > 0) {
        setActiveCategory(cats[0].id);
      }
      setLoading(false);
    };

    fetchMenu();
  }, []);

  const filteredItems = items.filter(item => item.category_id === activeCategory);

  const formatPrice = (price: number) => 
    new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', minimumFractionDigits: 0 }).format(price);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={40} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <Header />
      <main className="container mx-auto px-4 py-6">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft size={20} />
          <span>Voltar ao início</span>
        </Link>

        <div className="mb-6">
          <div className="flex items-center gap-2 text-primary mb-2">
            <Truck size={20} />
            <span className="font-medium">Pedido Online</span>
          </div>
          <h1 className="text-2xl font-display font-bold">Cardápio para Entrega</h1>
          <p className="text-muted-foreground">Escolha seus pratos favoritos e receba em casa</p>
        </div>

        <CategoryTabs
          categories={categories}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {filteredItems.map((item) => (
            <MenuItemCard key={item.id} item={item} />
          ))}
        </div>

        {filteredItems.length === 0 && (
          <p className="text-center text-muted-foreground py-8">Nenhum item nesta categoria</p>
        )}
      </main>

      {/* Fixed bottom cart bar */}
      {itemCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-4 shadow-lg">
          <div className="container mx-auto flex items-center justify-between gap-4">
            <div>
              <p className="font-bold">{itemCount} {itemCount === 1 ? 'item' : 'itens'}</p>
              <p className="text-primary font-bold">{formatPrice(total)}</p>
            </div>
            <Button onClick={() => navigate('/cart?type=online')} className="gap-2">
              <ShoppingCart size={18} />
              Ver Carrinho
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientOnlinePage;
