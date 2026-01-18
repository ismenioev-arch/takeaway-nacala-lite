import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, User, Loader2, ArrowLeft, Phone } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  emailSchema, 
  phoneSchema, 
  passwordSchema, 
  fullNameSchema 
} from '@/lib/validation';

type AuthMethod = 'email' | 'phone';

const AuthPage: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('phone');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp, signInWithPhone, signUpWithPhone } = useAuth();
  const navigate = useNavigate();

  const validateInputs = (): boolean => {
    try {
      if (authMethod === 'email') {
        emailSchema.parse(email);
      } else {
        phoneSchema.parse(phone);
      }
      passwordSchema.parse(password);
      if (!isLogin) {
        fullNameSchema.parse(fullName);
      }
      return true;
    } catch (error: any) {
      const message = error.errors?.[0]?.message || 'Dados inválidos';
      toast.error(message);
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateInputs()) return;
    
    setLoading(true);
    
    try {
      if (isLogin) {
        const { error } = authMethod === 'email' 
          ? await signIn(email, password)
          : await signInWithPhone(phone, password);
        if (error) throw error;
        toast.success('Bem-vindo de volta!');
        navigate('/menu');
      } else {
        const { error } = authMethod === 'email'
          ? await signUp(email, password, fullName)
          : await signUpWithPhone(phone, password, fullName);
        if (error) throw error;
        toast.success('Conta criada com sucesso!');
        navigate('/menu');
      }
    } catch (error: any) {
      const errorMessage = getErrorMessage(error.message);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const getErrorMessage = (message: string): string => {
    if (message.includes('User already registered')) {
      return 'Este utilizador já está registado';
    }
    if (message.includes('Invalid login credentials')) {
      return 'Credenciais inválidas';
    }
    if (message.includes('Email not confirmed')) {
      return 'Por favor confirme o seu email';
    }
    if (message.includes('Phone not confirmed')) {
      return 'Por favor confirme o seu telefone';
    }
    return message || 'Erro na autenticação';
  };

  const formatPhoneDisplay = (value: string) => {
    // Remove non-digits except +
    const cleaned = value.replace(/[^\d+]/g, '');
    // Remove +258 prefix for display if present
    return cleaned.replace(/^\+258/, '');
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-warm p-4">
      {/* Back button */}
      <div className="container mx-auto pt-4">
        <Link to="/" className="inline-flex items-center gap-2 text-foreground/80 hover:text-foreground transition-colors">
          <ArrowLeft size={20} />
          <span>Voltar</span>
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="card-elevated p-8">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-display font-bold text-primary mb-2">
                Teka<span className="text-accent">AWAY</span>
              </h1>
              <p className="text-muted-foreground">
                {isLogin ? 'Entre na sua conta' : 'Crie sua conta'}
              </p>
            </div>

            {/* Auth method tabs */}
            <Tabs value={authMethod} onValueChange={(v) => setAuthMethod(v as AuthMethod)} className="mb-6">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="phone" className="flex items-center gap-2">
                  <Phone size={16} />
                  Telefone
                </TabsTrigger>
                <TabsTrigger value="email" className="flex items-center gap-2">
                  <Mail size={16} />
                  Email
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                  <Input
                    type="text"
                    placeholder="Seu nome completo"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="pl-10"
                    required={!isLogin}
                    maxLength={100}
                  />
                </div>
              )}
              
              {authMethod === 'phone' ? (
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                  <div className="absolute left-10 top-1/2 -translate-y-1/2 text-muted-foreground text-sm border-r pr-2 mr-1">
                    +258
                  </div>
                  <Input
                    type="tel"
                    placeholder="84/85/86/87 XXXXXXX"
                    value={formatPhoneDisplay(phone)}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, '').slice(0, 9))}
                    className="pl-[5.5rem]"
                    required
                    maxLength={9}
                  />
                </div>
              ) : (
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                  <Input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                    maxLength={255}
                  />
                </div>
              )}

              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                <Input
                  type="password"
                  placeholder="Senha (mínimo 6 caracteres)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                  minLength={6}
                  maxLength={72}
                />
              </div>
              
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : isLogin ? 'Entrar' : 'Criar Conta'}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
                className="text-sm text-primary hover:underline"
              >
                {isLogin ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Entre'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default AuthPage;
