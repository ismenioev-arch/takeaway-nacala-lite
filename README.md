# takeaway-nacala-lite

Este repositório contém **dois produtos independentes**, que partilham o Git
e mais nada: código, dependências, base de dados e deploy são separados.

| | **Takeaway Nacala** | **WIM** |
|---|---|---|
| O que é | Aplicação do restaurante: menu, carrinho, mesas, pedidos, avaliações | WhatsApp Intelligence Manager — painel que organiza e prioriza as conversas de clientes |
| Onde está | raiz do repositório (`src/`) | `wim/` |
| Stack | React 18 + Vite + Tailwind + shadcn/ui | React + Vite (painel) · Node + Fastify + PostgreSQL (API) |
| Base de dados | Supabase | Neon (PostgreSQL) |
| Documentação | — | [`docs/wim/`](./docs/wim/) |

---

## Começar

### Takeaway Nacala

```bash
npm install
cp .env.example .env     # preencher com os valores do Supabase
npm run dev              # http://localhost:8080
```

| Comando | O que faz |
|---|---|
| `npm run dev` | Arranca em desenvolvimento |
| `npm run build` | Gera a versão final em `dist/` |
| `npm test` | Corre os testes (apenas os de `src/`) |
| `npm run lint` | Procura problemas no código |

### WIM

O `wim/` é um workspace npm: um `npm install` instala as duas metades.

```bash
cd wim
npm install
npm run setup:env        # gera os segredos de sessão
npm run migrate
npm run create-user
npm run dev              # API em :3001, painel em :5173
```

Guia completo: [`docs/wim/06-COMO-EXECUTAR.md`](./docs/wim/06-COMO-EXECUTAR.md).

---

## Pôr no ar

Os dois são publicados na Vercel, como **projectos separados do mesmo
repositório** — a diferença está na *Root Directory*:

| Projecto Vercel | Root Directory | Base de dados |
|---|---|---|
| Takeaway | raiz | Supabase |
| WIM | `wim` | Neon |

Passo a passo, com as variáveis de ambiente e o que verificar no fim:
**[`docs/wim/08-DEPLOY-VERCEL-NEON.md`](./docs/wim/08-DEPLOY-VERCEL-NEON.md)**.

---

## Documentação do WIM

| Documento | Assunto |
|---|---|
| [00-ARQUITETURA](./docs/wim/00-ARQUITETURA.md) | Decisões, modelo de dados, fases do projecto |
| [01-BASE-DE-DADOS](./docs/wim/01-BASE-DE-DADOS.md) | Tabelas, índices, migrações |
| [02-API](./docs/wim/02-API.md) | Endpoints, formatos, erros |
| [05-SEGURANCA](./docs/wim/05-SEGURANCA.md) | Autenticação, limites de pedidos, segredos |
| [06-COMO-EXECUTAR](./docs/wim/06-COMO-EXECUTAR.md) | Correr tudo localmente |
| [07-FASE5-PAINEL](./docs/wim/07-FASE5-PAINEL.md) | O painel: login, rotas, dados reais |
| [09-FASE6-WEBHOOK](./docs/wim/09-FASE6-WEBHOOK.md) | Recepção de mensagens do WhatsApp |
| [10-FASE8-IA](./docs/wim/10-FASE8-IA.md) | Análise pela IA, rascunhos e a regra de segurança |
| [11-FASE11-ENVIO](./docs/wim/11-FASE11-ENVIO.md) | Aprovar, editar e enviar respostas ao cliente |
| [08-DEPLOY-VERCEL-NEON](./docs/wim/08-DEPLOY-VERCEL-NEON.md) | Pôr em produção |
