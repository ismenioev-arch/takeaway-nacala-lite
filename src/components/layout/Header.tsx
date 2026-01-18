import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShoppingCart, User, LogOut, LayoutDashboard } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { Button } from '@/components/ui/button';

const Header: React.FC = () => {
  const { user, profile, signOut, isOwner, isOwnerOrAdmin } = useAuth();
  const { itemCount } = useCart();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-50 bg-card/95 backdrop-blur-md border-b border-border shadow-soft">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="text-2xl font-display font-bold text-primary"
            >
              Teka<span className="text-accent">AWAY</span>
            </motion.div>
            <span className="text-xs text-muted-foreground font-medium">Nacala</span>
          </Link>

          <nav className="flex items-center gap-3">
            {user ? (
              <>
                {isOwner && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/owner')}
                    className="gap-2"
                  >
                    <LayoutDashboard size={18} />
                    <span className="hidden sm:inline">Owner</span>
                  </Button>
                )}
                {isOwnerOrAdmin && !isOwner && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/admin')}
                    className="gap-2"
                  >
                    <LayoutDashboard size={18} />
                    <span className="hidden sm:inline">Admin</span>
                  </Button>
                )}
                <Link to="/cart" className="relative">
                  <Button variant="ghost" size="icon" className="relative">
                    <ShoppingCart size={20} />
                    {itemCount > 0 && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold"
                      >
                        {itemCount}
                      </motion.span>
                    )}
                  </Button>
                </Link>
                <Link to="/orders">
                  <Button variant="ghost" size="sm" className="gap-2">
                    <User size={18} />
                    <span className="hidden sm:inline truncate max-w-[100px]">
                      {profile?.full_name || 'Meus Pedidos'}
                    </span>
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSignOut}
                  className="text-destructive hover:text-destructive"
                >
                  <LogOut size={18} />
                </Button>
              </>
            ) : (
              <Link to="/auth">
                <Button variant="default" size="sm" className="gap-2">
                  <User size={18} />
                  Entrar
                </Button>
              </Link>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;
