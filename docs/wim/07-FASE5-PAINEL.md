# WIM — FASE 5: Painel com Autenticação, Dados Reais e Navegação

> **Estado:** FASE 5 concluída. O painel tem ecrã de login, navegação funcional, dados reais do backend, e protecção de rotas.

---

## 1. O que foi implementado

### 1.1 Autenticação no Frontend

**Contexto de Autenticação (`AuthContext.tsx`):**
- Armazena tokens (accessToken, refreshToken) no localStorage
- Valida sessão ao carregar o app
- Renova tokens automaticamente antes de expirarem (verificação a cada 60 segundos)
- Fornece hooks `useAuth()` para componentes consumirem estado da autenticação
- Logout limpa tokens e localStorage

**Token Refresh automático:**
- O cliente API intercepta 401 e tenta renovar o token automaticamente
- Se a renovação falhar, força logout
- Access tokens expiram em 15 minutos; refresh tokens em 30 dias

### 1.2 Ecrã de Login

**`LoginPage.tsx`:**
- Formulário de email/password
- Validação básica
- Redireciona utilizadores autenticados para o dashboard
- Redireciona não-autenticados de volta ao login
- Erros amigáveis (ex: «E-mail ou password incorrectos»)
- Protecção contra envios duplos (botão fica desabilitado durante requisição)

### 1.3 Route Guards

**`ProtectedRoute.tsx`:**
- Verifica autenticação antes de mostrar rotas protegidas
- Redireciona não-autenticados para `/login`
- Mostra carregamento enquanto verifica sessão

**Rotas:**
- `/login` — pública
- `/` — dashboard (protegido)
- `/atencao` — conversas que precisam de atenção (protegido)
- `/conversas` — listagem de conversas (protegido)
- `/clientes` — cadastro de clientes (protegido)
- `/definicoes` — definições do utilizador (protegido)

### 1.4 Cliente API Melhorado

**Endpoints adicionados:**
```typescript
api.auth.login(email, password)       // POST /api/auth/login
api.auth.refresh(refreshToken)        // POST /api/auth/refresh
api.auth.logout(refreshToken)         // POST /api/auth/logout
api.auth.me(accessToken)              // GET /api/auth/me
api.conversations.counts(accessToken) // GET /api/conversations/counts
api.conversations.attention(accessToken) // GET /api/conversations/attention
api.conversations.list(accessToken, filters) // GET /api/conversations
```

**Interceptador de 401:**
- Quando o backend retorna 401, o cliente tenta renovar o token automaticamente
- Se a renovação succeeds, o pedido original é refeito com o novo token
- Se falhar, o erro 401 é propagado e o app força logout

### 1.5 Dashboard com Dados Reais

**`DashboardPage.tsx` actualizada:**
- Os cartões de prioridade (Urgente, Importante, Acompanhar, Normal) mostram números reais
- Contador de total de conversas, não respondidas e a aguardar aprovação
- React Query para cache e refetch automático a cada 30 segundos
- Estados de carregamento: mostra "…" enquanto carrega; "!" se erro

**Hook `useConversationCounts`:**
- Usa React Query `useQuery` com cache configurável
- Refetch automático a cada 30 segundos
- Ativado apenas quando autenticado

### 1.6 Novos Ecrãs

**«Precisa da Minha Atenção» (`/atencao`):**
- Lista de conversas que requerem intervenção
- Cada conversa mostra: contacto, resumo da IA, acção recomendada, última mensagem, tempo desde recebimento
- Cores por prioridade
- Refetch automático

**Conversas (`/conversas`):**
- Listagem com filtros (status: Abertas/Resolvidas/Todas)
- Paginação
- Cada conversa mostra: contacto, assunto, última mensagem, não lidas, data
- Refetch automático

**Clientes (`/clientes`):**
- Placeholder funcional — pronto para integração com `/api/contacts`
- Mensagem "A chegar quando as mensagens começarem"

**Definições (`/definicoes`):**
- Informações do utilizador: nome, e-mail, papel
- Botão de logout
- Placeholder para mudança de password (próximas fases)

### 1.7 Layout Melhorado

**AppLayout.tsx actualizado:**
- Sidebar no desktop mostra informações do utilizador e botão de logout
- Header no móvel tem botão de logout rápido
- Todos os NAV_ITEMS estão `enabled: true` — navegação funcional
- Integração com `useAuth()` para mostrar nome do utilizador

---

## 2. Estrutura de Ficheiros

```
wim/
├── frontend/src/
│   ├── contexts/
│   │   └── AuthContext.tsx          ← Contexto de autenticação
│   ├── pages/
│   │   ├── LoginPage.tsx            ← Ecrã de entrada
│   │   ├── DashboardPage.tsx        ← Painel (actualizado com dados reais)
│   │   ├── AttentionPage.tsx        ← Conversas que precisam atenção
│   │   ├── ConversationsPage.tsx    ← Listagem de conversas
│   │   ├── ClientsPage.tsx          ← Cadastro de clientes
│   │   └── SettingsPage.tsx         ← Definições do utilizador
│   ├── components/
│   │   └── ProtectedRoute.tsx       ← Route guard
│   ├── layouts/
│   │   └── AppLayout.tsx            ← Layout principal (actualizado)
│   ├── hooks/
│   │   ├── useAuth.ts               ← Hook de autenticação
│   │   └── useConversationCounts.ts ← Hook para contadores
│   ├── types/
│   │   └── auth.ts                  ← Tipos de autenticação
│   ├── services/
│   │   └── api.ts                   ← Cliente API melhorado
│   ├── App.tsx                      ← Rotas (actualizado)
│   └── main.tsx                     ← AuthProvider (actualizado)
```

---

## 3. Fluxo de Autenticação

```
1. Utilizador acede a http://localhost:5173
   ↓
2. App carrega, AuthContext verifica localStorage
   ↓
3. Se não autenticado → redireciona para /login
   ↓
4. LoginPage: email + password → POST /api/auth/login
   ↓
5. Backend retorna { user, accessToken, refreshToken, expiresIn }
   ↓
6. AuthContext armazena em localStorage e sessionStorage
   ↓
7. App redireciona para / (dashboard)
   ↓
8. Todo o pedido à API inclui `Authorization: Bearer <accessToken>`
   ↓
9. Se accessToken expirar → cliente tenta renovar com refreshToken
   ↓
10. Se refresh succeeds → novo token, refaz pedido original
    Se refresh falha → logout automático, volta a /login
```

---

## 4. Segurança

- **Tokens em localStorage:** O access token é necessário para cada pedido, mas não é secreto (pode ser lido por JS). O refresh token nunca é enviado numa requisição — fica guardado localmente.
- **Rotação de refresh token:** Cada `/api/auth/refresh` consome o token antigo. Reutilização é detectada como suspeita de roubo.
- **HTTPS obrigatório em produção:** Sem TLS, os tokens viajam em claro.
- **HttpOnly cookies não usados:** Os tokens ficam em localStorage para simplicidade. Em produção, preferir HttpOnly + Secure + SameSite.

---

## 5. Estados de Carregamento e Erros

- **Durante login:** Botão fica desabilitado, campos desabilitados, "A entrar..."
- **Durante load de dados:** Cartões mostram "…" (carregando) ou "!" (erro)
- **401 não autenticado:** Redireciona para /login automaticamente
- **Rede indisponível:** Erro `NETWORK_ERROR` amigável

---

## 6. Como Testar

### Teste local (dev)

**Terminal 1 — Backend:**
```bash
cd wim/backend
npm run migrate   # se necessário
npm run seed      # dados de exemplo
npm run dev
```

**Terminal 2 — Frontend:**
```bash
cd wim/frontend
npm run dev
```

**Navegador:**
```
http://localhost:5173
```

Será redireccionado para `/login`. Para entrar:
- Criar um utilizador no backend: `npm run create-user` (Terminal 1)
- Ou usar dados de teste (ver abaixo)

### Dados de teste

Os testes do backend criam utilizadores on-the-fly. Para desenvolvimento manual, usar dados de exemplo como:
- Email: `teste-xxx@exemplo.mz` (qualquer email funciona se não existir)
- Password: Qualquer password com ≥12 caracteres

Ou executar:
```bash
# Terminal 1 (backend), em outro terminal
npm run create-user
```

### Teste ponta a ponta

1. Abrir http://localhost:5173
2. Verá a página de login
3. Preencher credenciais
4. Após login:
   - Dashboard mostra cartões com números reais
   - "Atenção" lista conversas urgentes
   - "Conversas" lista todas com filtros
   - "Definições" mostra utilizador e logout
5. Logout volta a /login

---

## 7. Integrações Pendentes

As seguintes funcionalidades estão prontas no backend, aguardando integração no frontend:

| Funcionalidade | Backend | Frontend | Fase |
|---|---|---|---|
| Listar conversas com filtros avançados | ✔ | Básico | 5 |
| Listar contactos | ✔ | ✗ | 6 |
| Criar contacto | ✔ | ✗ | 6 |
| Ver mensagens de conversa | ✔ | ✗ | 6 |
| Enviar mensagem | ✗ (aguarda WhatsApp) | ✗ | 11 |
| Aprovar rascunho da IA | ✗ (aguarda IA) | ✗ | 10 |
| Análise da IA | ✗ (aguarda IA) | ✗ | 8 |

---

## 8. Configuração do Frontend

### `.env` (não commitado)

Em produção, definir:
```
VITE_API_URL=https://api.prod.example.com
```

Em desenvolvimento, o Vite usa o proxy em `vite.config.ts`:
```typescript
proxy: {
  '/api': { target: 'http://localhost:3001', changeOrigin: true }
}
```

---

## 9. Notas de Implementação

- **React Context vs Redux:** AuthContext é simples e suficiente para este caso. Redux seria excessivo.
- **React Query:** Usado para cache de dados e refetch automático. Configurado para refetch a cada 30s em dados de conversas.
- **TypeScript strict mode:** Todo o código frontend é type-safe. Nenhum `any`.
- **Tailwind CSS:** Reutiliza cores de paleta existentes (`urgente`, `importante`, `acompanhar`, `normal`).

---

## 10. O que vem a seguir

**FASE 6 — Webhook do WhatsApp:**
- Receber mensagens em tempo real
- Armazenar no banco
- Atualizar dashboard instantaneamente (via SSE ou polling melhorado)

**FASE 7 — Recepção de Mensagens:**
- Consumir webhook do WhatsApp Business Cloud API
- Armazenar conversas e mensagens
- Idempotência via `wa_message_id`

**FASE 8 — Análise pela IA:**
- Integrar Claude API
- Processar cada mensagem recebida
- Sugerir prioridade, intenção, resumo, acção recomendada

**FASE 10 — Aprovação de Rascunhos:**
- Interface para aprovação/edição de sugestões da IA
- Enviar respostas aprovadas para WhatsApp
- Histórico de quem aprovou o quê

**FASE 12+ — Notifications, Follow-ups, Métricas**
