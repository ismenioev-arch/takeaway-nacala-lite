import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Utensils, QrCode, Smartphone, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import heroImage from '@/assets/hero-restaurant.jpg';

const Index: React.FC = () => {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0">
        <img src={heroImage} alt="Teka AWAY Nacala" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-hero" />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Hero Section */}
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-12">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-full mb-6">
              <Utensils className="text-accent" size={18} />
              <span className="text-white/90 text-sm font-medium">Restaurante Moçambicano</span>
            </div>

            <h1 className="text-5xl md:text-7xl font-display font-bold text-white mb-4">
              Teka<span className="text-accent">AWAY</span>
            </h1>
            <p className="text-xl md:text-2xl text-white/80 font-light mb-2">Nacala</p>
            <p className="text-white/60 max-w-md mx-auto mb-8">
              Sabores autênticos de Moçambique com vista para o oceano Índico
            </p>

            <Link to="/auth">
              <Button size="lg" className="gap-2 text-lg px-8 py-6">
                Fazer Pedido <ArrowRight size={20} />
              </Button>
            </Link>
          </motion.div>
        </div>

        {/* Features Section */}
        <div className="bg-background/95 backdrop-blur-md py-8 px-4">
          <div className="container mx-auto">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="grid grid-cols-1 md:grid-cols-3 gap-6"
            >
              <div className="flex items-center gap-4 p-4 rounded-xl bg-card">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <QrCode className="text-primary" size={24} />
                </div>
                <div>
                  <h3 className="font-bold">Pedido por QR Code</h3>
                  <p className="text-sm text-muted-foreground">Escaneie na mesa e peça</p>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 rounded-xl bg-card">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Smartphone className="text-primary" size={24} />
                </div>
                <div>
                  <h3 className="font-bold">Pagamento M-Pesa</h3>
                  <p className="text-sm text-muted-foreground">Pague com seu celular</p>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 rounded-xl bg-card">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Star className="text-primary" size={24} />
                </div>
                <div>
                  <h3 className="font-bold">Acompanhe seu Pedido</h3>
                  <p className="text-sm text-muted-foreground">Status em tempo real</p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        {/* About Section */}
        <div className="bg-card py-12 px-4">
          <div className="container mx-auto text-center max-w-2xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              <h2 className="text-2xl md:text-3xl font-display font-bold mb-4">Sobre Nós</h2>
              <p className="text-muted-foreground mb-6">
                O TekaAWAY Nacala oferece a melhor experiência gastronómica moçambicana. 
                Desde o tradicional caril de amendoim até pratos contemporâneos inspirados 
                na nossa rica cultura culinária, cada prato é preparado com ingredientes 
                frescos e temperos autênticos.
              </p>
              <div className="flex flex-wrap justify-center gap-4 text-sm">
                <div className="bg-muted px-4 py-2 rounded-full">
                  <span className="font-medium">📍</span> Nacala, Moçambique
                </div>
                <div className="bg-muted px-4 py-2 rounded-full">
                  <span className="font-medium">🕐</span> 07:00 - 22:00
                </div>
                <div className="bg-muted px-4 py-2 rounded-full">
                  <span className="font-medium">📞</span> +258 84 XXX XXX
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
