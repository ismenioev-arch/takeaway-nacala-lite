# WIM — Pôr no ar: Vercel + Neon

> **Estado:** o código está pronto para deploy. Este documento é o guia a
> seguir, do princípio ao fim, para quem está à frente de um computador com o
> repositório e nada mais.

Há duas coisas para publicar neste repositório:

| Projecto | O que é | Onde vive | Base de dados |
|---|---|---|---|
| **WIM** | Painel + API do WhatsApp Intelligence Manager | `wim/` | **Neon** (PostgreSQL) |
| **Takeaway Nacala** | Aplicação do restaurante | raiz do repositório | Supabase (já existente) |

São **dois projectos Vercel separados**, do mesmo repositório Git, cada um
com a sua *Root Directory*. Podem ser publicados em alturas diferentes e um
não derruba o outro.

---

## 1. Como fica montado o WIM

```
  Browser
     │
     │  https://wim-nacala.vercel.app
     ▼
  ┌─────────────────────────────────────────┐
  │              Vercel                      │
  │                                          │
  │   /            →  painel React (CDN)     │
  │   /conversas   →  painel React (CDN)     │
  │   /api/...     →  função  (wim/api)      │
  └─────────────────┬────────────────────────┘
                    │  ligação cifrada
                    ▼
            ┌───────────────┐
            │     Neon      │   PostgreSQL
            └───────────────┘
```

**Um único domínio para as duas metades.** O painel pede `/api/conversations`
ao mesmo endereço de onde foi descarregado. Não há CORS para configurar, não
há um segundo URL para manter sincronizado, e um `fetch` que funciona em
desenvolvimento funciona em produção pela mesma razão.

### O que muda em relação a correr num servidor

O código da API é **exactamente o mesmo**. O que muda é quem o arranca:

| | Servidor (Docker, VPS) | Vercel |
|---|---|---|
| Ponto de entrada | `backend/src/server.ts` | `api/index.ts` |
| Ciclo de vida | um processo, sempre de pé | um processo por invocação, congelado depois de responder |
| Ligações à BD | um pool de 10 | pool de 2, multiplexado pelo pooler do Neon |
| Trabalho em segundo plano | continua depois da resposta | **não sobrevive** — ver secção 7 |

O ficheiro `wim/api/index.ts` tem dez linhas de substância: constrói a app
Fastify uma vez por processo e entrega-lhe cada pedido. Toda a lógica
—rotas, autenticação, validação, erros— continua onde sempre esteve.

---

## 2. Antes de começar

Precisa de três contas, todas com plano gratuito suficiente para arrancar:

- **GitHub** — já tem, é onde está este repositório
- **Neon** — <https://neon.tech>
- **Vercel** — <https://vercel.com>

E de nada mais. Em particular, **não** precisa ainda de:

- conta do WhatsApp Business aprovada pela Meta
- chave da Anthropic

O sistema foi preparado para subir sem elas (ver secção 6).

---

## 3. Neon — criar a base de dados

### 3.1 Criar o projecto

1. Entre em <https://console.neon.tech> e crie um projecto.
2. **Região:** escolha a mais próxima dos utilizadores. Para Moçambique, a
   melhor opção costuma ser `AWS eu-central-1 (Frankfurt)`. A distância
   custa milissegundos em cada consulta e eles somam-se.
3. **Versão do PostgreSQL:** 16 ou superior.
4. Dê um nome à base de dados: `wim`.

### 3.2 Copiar a ligação certa

No painel do Neon, em **Connection string**, há duas variantes. A diferença
importa:

```
# ✅ ESTA — com "-pooler" no nome
postgresql://utilizador:password@ep-nome-123456-pooler.eu-central-1.aws.neon.tech/wim?sslmode=require

# ❌ Esta não — ligação directa
postgresql://utilizador:password@ep-nome-123456.eu-central-1.aws.neon.tech/wim?sslmode=require
```

**Porquê a `-pooler`:** cada pedido simultâneo na Vercel é um processo
diferente, e cada um abriria as suas ligações. Sem pooler, uma meia dúzia de
utilizadores ao mesmo tempo esgota o limite de ligações do Neon e a API
começa a devolver erros que parecem aleatórios. O pooler fica no meio e
resolve isso.

> O `?sslmode=require` no fim não é decorativo. O backend lê o URL e activa
> a ligação cifrada por causa dele — não é preciso configurar mais nada.

Guarde este URL. Vai usá-lo duas vezes: agora, para as migrações, e a
seguir, nas variáveis da Vercel.

### 3.3 Criar as tabelas

A partir do seu computador, com o repositório clonado:

```bash
cd wim
npm install

export DATABASE_URL='postgresql://...-pooler.../wim?sslmode=require'
export JWT_ACCESS_SECRET="$(openssl rand -base64 48)"
export JWT_REFRESH_SECRET="$(openssl rand -base64 48)"

npm run migrate
```

Deve ver:

```
Aplicadas 3 migração(ões):
  ✔ 001_initial.sql
  ✔ 002_core_domain.sql
  ✔ 003_auth.sql
```

Confirme com `npm run migrate:status`.

> **Não corra `npm run seed` contra o Neon.** Os dados de exemplo servem para
> desenvolvimento e o comando recusa-se a correr com `NODE_ENV=production`,
> mas é melhor não o pôr à prova numa base de dados real.

### 3.4 Criar o primeiro utilizador

Não há registo aberto no WIM — o primeiro utilizador cria-se pela linha de
comandos, e é o proprietário do sistema:

```bash
npm run create-user
```

Responde a quatro perguntas (e-mail, nome, password, confirmação). A
password não aparece no ecrã.

---

## 4. Vercel — publicar o WIM

### 4.1 Gerar os segredos de sessão

São o que assina as sessões dos utilizadores. Dois valores diferentes:

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
```

Guarde-os. Se os perder, as sessões activas deixam de ser válidas — nada de
grave, mas toda a gente tem de entrar outra vez.

### 4.2 Criar o projecto

1. Na Vercel: **Add New… → Project** e escolha este repositório.
2. Em **Root Directory**, carregue em *Edit* e escolha **`wim`**.
   É o passo mais importante de toda a configuração. Sem isto a Vercel
   tenta publicar o app de takeaway da raiz.
3. **Framework Preset:** `Other`. O resto (comando de build, pasta de saída,
   a função da API) vem do `wim/vercel.json` que já está no repositório —
   não preencha nada à mão.

### 4.3 Variáveis de ambiente

Em **Settings → Environment Variables**, para os ambientes *Production* e
*Preview*:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | o URL `-pooler` do Neon, com `?sslmode=require` |
| `JWT_ACCESS_SECRET` | o primeiro segredo gerado |
| `JWT_REFRESH_SECRET` | o segundo segredo gerado (diferente do primeiro) |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | `https://o-seu-dominio.vercel.app` |
| `LOG_LEVEL` | `info` |

E, por agora, **nada mais**. As integrações ficam desligadas por omissão.

> `CORS_ORIGIN` é uma rede de segurança: como o painel e a API partilham o
> domínio, os pedidos do painel nem sequer são "cross-origin". A variável
> serve para o caso de alguém tentar chamar a sua API a partir de outro sítio.

### 4.4 Publicar

Carregue em **Deploy**. Ao fim de um ou dois minutos, verifique:

```bash
curl https://o-seu-dominio.vercel.app/api/health
```

Resposta esperada:

```json
{
  "status": "ok",
  "service": "wim-backend",
  "environment": "production",
  "features": { "whatsapp": false, "ai": false },
  "database": { "connected": true, "latencyMs": 24, "serverVersion": "PostgreSQL 17.2" }
}
```

Se `database.connected` for `true`, está feito: abra o domínio no browser e
entre com o utilizador criado no passo 3.4.

---

## 5. Vercel — publicar o Takeaway

Projecto separado, do mesmo repositório:

1. **Add New… → Project**, o mesmo repositório.
2. **Root Directory:** deixe na raiz (não escolha `wim`).
3. **Framework Preset:** `Vite` — o `vercel.json` da raiz confirma o resto.
4. Variáveis de ambiente:

| Variável | Valor |
|---|---|
| `VITE_SUPABASE_URL` | URL do projecto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | chave `anon` do Supabase |

Estas duas vão parar dentro do JavaScript que o browser descarrega, e isso
é normal: a chave `anon` foi desenhada para ser pública e quem protege os
dados são as políticas de Row Level Security do Supabase. O que **nunca**
pode ser posto aqui é a chave `service_role`.

> **Nota sobre o estado deste app:** faltavam no repositório os ficheiros de
> configuração do Tailwind e do TypeScript (`tailwind.config.ts`,
> `postcss.config.js`, `tsconfig.app.json`, `tsconfig.node.json`) — sem eles
> o `npm run build` falhava e o deploy era impossível. Foram criados. O
> `index.css` também tinha o `@import` das tipografias depois das directivas
> do Tailwind, o que fazia o empacotador descartar a linha; está corrigido.

---

## 6. Ligar o WhatsApp e a IA mais tarde

O sistema arranca com as duas integrações desligadas e diz isso de forma
explícita:

- `GET /api/health` devolve `"features": { "whatsapp": false, "ai": false }`
- o painel mostra **WhatsApp: Desligado** no cartão de estado
- `/api/webhooks/whatsapp` responde **503** com a razão, em vez de 404

Essa escolha é deliberada. Um 404 mandaria quem está a configurar o webhook
na Meta procurar um erro de URL que não existe; o 503 diz a verdade — o
endereço está certo, a funcionalidade é que não foi ligada.

### Quando tiver as credenciais da Meta

Acrescente nas variáveis de ambiente da Vercel e volte a publicar:

| Variável | Onde a obter |
|---|---|
| `WHATSAPP_ENABLED` | `true` |
| `WHATSAPP_APP_SECRET` | Meta for Developers → a sua app → Definições → Básico → Chave Secreta |
| `WHATSAPP_VERIFY_TOKEN` | inventado por si; tem de ser igual no painel da Meta |
| `WHATSAPP_ACCESS_TOKEN` | token de **System User** (permanente), não o temporário de 24 h |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta for Developers → WhatsApp → Configuração da API |

Com `WHATSAPP_ENABLED=true` e alguma destas em falta, **o deploy falha a
arrancar e diz qual falta**. É de propósito: mais vale falhar no arranque,
com uma mensagem clara, do que ficar meio ligado e perder mensagens de
clientes sem ninguém dar por isso.

O `WHATSAPP_APP_SECRET` é exigido em qualquer ambiente quando a integração
está ligada. Sem ele, o webhook não consegue distinguir um evento verdadeiro
da Meta de um evento forjado por qualquer pessoa que descubra o URL.

**URL para registar na Meta:**
`https://o-seu-dominio.vercel.app/api/webhooks/whatsapp`

### Quando tiver a chave da Anthropic

| Variável | Valor |
|---|---|
| `AI_ENABLED` | `true` |
| `ANTHROPIC_API_KEY` | a chave |

---

## 7. O que é diferente em serverless (e já está tratado)

Três armadilhas conhecidas, e como o código lida com cada uma.

### 7.1 Trabalho depois da resposta desaparece

Num servidor, responder primeiro e processar depois é a melhor escolha: a
Meta recebe o `200 OK` em milissegundos. Numa função, o processo é congelado
assim que a resposta sai — e o processamento morre a meio, sem erro e sem
nova tentativa, porque a Meta já considerou o evento entregue.

O webhook detecta onde está a correr (a Vercel define `VERCEL=1`) e, em
serverless, **espera** que a mensagem fique guardada antes de responder. Se
falhar, devolve 500 para a Meta tentar de novo; a idempotência por
`wa_message_id` garante que a repetição não duplica nada.

### 7.2 Demasiadas ligações à base de dados

Dez pedidos simultâneos são dez processos. Com um pool de 10 em cada um,
seriam 100 ligações contra o Neon — muito acima do que o plano gratuito
aceita. Em serverless, o pool é limitado a 2 (`resolvePoolMax`), e quem faz
a multiplexação é o pooler do Neon.

### 7.3 SSL que parece funcionar em local e falha em produção

O `pg` ignora o `sslmode` do URL quando lhe passamos a opção `ssl`
explicitamente. O resultado é um erro que não aponta para a causa: *"the
server does not support SSL connections"*. O backend passou a ler o URL: se
tiver `sslmode=require`, usa ligação cifrada, sem mais configuração.

### 7.4 Arranque a frio

A primeira chamada depois de um período sem tráfego demora mais — a função
tem de arrancar e ligar-se à base de dados. Com o plano gratuito do Neon há
ainda o *scale to zero*: a própria base de dados adormece e leva alguns
segundos a acordar. Para um painel interno isto é aceitável. Se incomodar,
o plano pago do Neon mantém-na acordada.

---

## 8. Actualizações seguintes

Depois do primeiro deploy, publicar é só fazer `git push`: a Vercel constrói
e publica sozinha, e cada Pull Request ganha o seu URL de pré-visualização.

**As migrações não correm sozinhas** — e isso é deliberado. Uma migração que
corre no meio de um deploy automático, contra dados reais, é a forma mais
rápida de ter um problema difícil de desfazer. Quando houver uma migração
nova:

```bash
cd wim
export DATABASE_URL='postgresql://...-pooler.../wim?sslmode=require'
npm run migrate:status   # ver o que falta
npm run migrate          # aplicar
```

Aplique a migração **antes** de publicar o código que depende dela.

---

## 9. Quando alguma coisa corre mal

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Deploy falha: *Configuração inválida* | falta uma variável de ambiente | a mensagem lista exactamente quais; os logs da função mostram-na |
| `/api/health` → `"connected": false` | `DATABASE_URL` errado, ou base adormecida | confirme o URL `-pooler`; tente de novo passados 10 s |
| Tudo devolve 404 | *Root Directory* não está em `wim` | Settings → General → Root Directory |
| Painel abre mas o login falha com erro de rede | a função não arrancou | Vercel → Deployments → Functions → logs |
| Login devolve 401 com a password certa | o utilizador foi criado noutra base de dados | volte a correr `npm run create-user` com o `DATABASE_URL` de produção |
| Webhook devolve 503 | `WHATSAPP_ENABLED` está `false` | é o comportamento esperado; ver secção 6 |
| *too many connections for role* | está a usar o URL sem `-pooler` | troque pelo URL com `-pooler` |

**Onde ver os logs:** Vercel → o projecto → *Deployments* → o deploy →
*Functions* → `api/index`. Cada erro traz um `requestId` que também é
devolvido ao cliente, o que permite ligar uma queixa de um utilizador à
linha certa do log.

---

## 10. Lista de verificação

Antes de considerar o sistema no ar:

- [ ] `GET /api/health` devolve `status: "ok"` e `database.connected: true`
- [ ] O painel abre e redirecciona para `/login`
- [ ] O login funciona com o utilizador criado
- [ ] Recarregar a página numa rota interna (ex.: `/conversas`) não dá 404
- [ ] `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET` são diferentes um do outro
- [ ] O `DATABASE_URL` é o do pooler
- [ ] Nenhum segredo está escrito em ficheiros com commit (`git grep` pelos valores)
- [ ] O app de takeaway abre no seu próprio domínio
