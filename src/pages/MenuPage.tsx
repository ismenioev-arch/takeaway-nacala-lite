import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import Header from '@/components/layout/Header';
import CategoryTabs from '@/components/menu/CategoryTabs';
import MenuItemCard from '@/components/menu/MenuItemCard';
import TableSelector from '@/components/tables/TableSelector';
import { useCart } from '@/contexts/CartContext';
import { Loader2, ArrowLeft } from 'lucide-react';

const MenuPage: React.FC = () => {
  const [categories, setCategories] = useState<any[]>([]);
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { selectedTable, setSelectedTable } = useCart();

  useEffect(() => {
    const fetchData = async () => {
      const [categoriesRes, itemsRes, tablesRes] = await Promise.all([
        supabase.from('menu_categories').select('*').order('display_order'),
        supabase.from('menu_items').select('*').eq('is_available', true),
        supabase.from('restaurant_tables').select('*').order('number'),
      ]);
      setCategories(categoriesRes.data || []);
      setMenuItems(itemsRes.data || []);
      setTables(tablesRes.data || []);
      setLoading(false);
    };
    fetchData();
  }, []);

  const filteredItems = activeCategory
    ? menuItems.filter((item) => item.category_id === activeCategory)
    : menuItems;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={40} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-8">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={20} />
          <span>Voltar ao início</span>
        </Link>
        {!selectedTable && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <TableSelector
              tables={tables}
              selectedTable={selectedTable}
              onSelectTable={setSelectedTable}
            />
          </motion.div>
        )}

        {selectedTable && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Mesa selecionada:</span>
            <span className="bg-primary text-primary-foreground px-3 py-1 rounded-full font-bold">
              {selectedTable}
            </span>
            <button onClick={() => setSelectedTable(null)} className="text-primary underline text-xs">
              Alterar
            </button>
          </div>
        )}

        <div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-4">Cardápio</h2>
          <CategoryTabs
            categories={categories}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => (
            <MenuItemCard key={item.id} item={item} />
          ))}
        </div>
      </main>
    </div>
  );
};

export default MenuPage;
