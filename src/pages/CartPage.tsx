import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ShoppingBag, ArrowRight } from 'lucide-react';
import Header from '@/components/layout/Header';
import CartItem from '@/components/cart/CartItem';
import { useCart } from '@/contexts/CartContext';
import { Button } from '@/components/ui/button';

const CartPage: React.FC = () => {
  const { items, selectedTable, total } = useCart();
  const navigate = useNavigate();

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: 'MZN', minimumFractionDigits: 0 }).format(price);
  };

  const handleProceedToCheckout = () => {
    navigate('/checkout');
  };

  return (
    <div className="min-h-screen bg-background pb-32">
      <Header />
      <main className="container mx-auto px-4 py-6">
        <Link to="/menu" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft size={20} /> Voltar ao cardápio
        </Link>

        <h1 className="text-2xl font-display font-bold mb-6">Seu Carrinho</h1>

        {items.length === 0 ? (
          <div className="text-center py-12">
            <ShoppingBag className="mx-auto text-muted-foreground mb-4" size={48} />
            <p className="text-muted-foreground">Seu carrinho está vazio</p>
            <Link to="/menu"><Button className="mt-4">Ver Cardápio</Button></Link>
          </div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence>{items.map((item) => <CartItem key={item.id} item={item} />)}</AnimatePresence>
            
            <div className="card-elevated p-6 mt-6">
              {selectedTable && <p className="text-sm text-muted-foreground mb-4">Mesa: <strong>{selectedTable}</strong></p>}
              <div className="flex justify-between items-center text-xl font-bold mb-4">
                <span>Total</span>
                <span className="text-primary">{formatPrice(total)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Fixed bottom checkout button */}
        {items.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t">
            <div className="container mx-auto">
              <Button 
                onClick={handleProceedToCheckout}
                className="w-full gap-2"
                size="lg"
              >
                Continuar para Pagamento <ArrowRight size={20} />
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default CartPage;
