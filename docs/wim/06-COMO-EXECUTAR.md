# WIM — Como executar

Guia passo a passo. Escrito para quem não programa: siga pela ordem.

> **Estado:** FASES 6-7 concluídas. O sistema recebe mensagens do WhatsApp
> via webhook (HMAC validado, idempotente), e analisa cada mensagem com Claude
> (intent, priority, urgency, recommended actions). O painel mostra análises
> em tempo real. Próximas: geração de rascunhos automáticos (FASE 8).
>
> ⚠️ Em produção, coloque sempre atrás de HTTPS — ver a lista final de
> [`05-SEGURANCA.md`](./05-SEGURANCA.md).
>
> Ver também [`01-BASE-DE-DADOS.md`](./01-BASE-DE-DADOS.md) e
> [`02-API.md`](./02-API.md).

---

## O que precisa de ter instalado

| Programa | Versão | Como confirmar |
|---|---|---|
| Node.js | 20 ou superior | `node --version` |
| PostgreSQL | 14 ou superior | `psql --version` |
| Docker *(opcional)* | qualquer recente | `docker --version` |

Se usar o Docker, não precisa de instalar o PostgreSQL — ele vem incluído.

---

## Opção 1 — Com Docker (mais simples)

Um comando levanta tudo: base de dados, backend e painel.

```bash
cd wim/docker
cp .env.example .env
```

Abra o ficheiro `.env` e preencha, no mínimo:

```
POSTGRES_PASSWORD=<invente uma password forte>
```

Para gerar uma password forte:

```bash
openssl rand -base64 32
```

Depois:

```bash
docker compose up --build
```

Quando terminar de arrancar:

- Painel: <http://localhost:8080>
- API: <http://localhost:3001/api/health>

Para parar: `Ctrl+C`. Para parar e apagar os dados: `docker compose down -v`.

> ⚠️ **Ainda não testámos este caminho ponta a ponta.** A sintaxe do
> `docker-compose.yml` está validada, mas a máquina onde o código foi
> desenvolvido não tem o serviço Docker a correr, por isso as imagens nunca
> chegaram a ser construídas. Se algo falhar aqui, diga-me e corrijo — não
> quero afirmar que funciona sem ter visto funcionar.

---

## Opção 2 — Sem Docker (foi assim que testámos)

### Passo 1 — Preparar a base de dados

```bash
sudo -u postgres psql -c "CREATE ROLE wim LOGIN PASSWORD 'wim_dev_password';"
sudo -u postgres psql -c "CREATE DATABASE wim OWNER wim;"
sudo -u postgres psql -c "CREATE DATABASE wim_test OWNER wim;"
```

A base `wim_test` é usada apenas pelos testes automáticos. Estão separadas
de propósito: nenhum teste consegue apagar dados reais.

### Passo 2 — Backend

```bash
cd wim/backend
npm install
npm run setup:env
```

O `npm run setup:env` cria o ficheiro `.env` e **gera os segredos de sessão**
automaticamente. Sem eles o servidor não arranca — são o que assina as
sessões dos utilizadores.

Se a sua base de dados não for a predefinida, ajuste esta linha no `.env`:

```
DATABASE_URL=postgresql://wim:wim_dev_password@localhost:5432/wim
```

Para receber mensagens do WhatsApp (FASE 6) e análise de IA (FASE 7), adicione
ao `.env`:

```
# WhatsApp Webhook (FASE 6)
WHATSAPP_VERIFY_TOKEN=seu_token_aleatorio_aqui
WHATSAPP_APP_SECRET=seu_app_secret_da_meta
WHATSAPP_PHONE_NUMBER_ID=seu_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=seu_business_account_id

# Claude para análise de mensagens (FASE 7)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5
AI_EFFORT=medium
AI_CONFIDENCE_THRESHOLD=0.9
```

Ver detalhes em [`06-FASE6-WEBHOOK.md`](./06-FASE6-WEBHOOK.md).

Criar as tabelas:

```bash
npm run migrate
```

Deve ver:

```
Aplicadas 3 migração(ões):
  ✔ 001_initial.sql
  ✔ 002_core_domain.sql
  ✔ 003_auth.sql
```

Opcional — inserir dados de exemplo para ver o sistema com conteúdo:

```bash
npm run seed
```

Criar o seu utilizador (o primeiro fica proprietário do sistema):

```bash
npm run create-user
```

Arrancar o servidor:

```bash
npm run dev
```

Confirmar noutro terminal:

```bash
curl http://localhost:3001/api/health
```

Resposta esperada:

```json
{
  "status": "ok",
  "service": "wim-backend",
  "database": { "connected": true, "serverVersion": "PostgreSQL 16.13" }
}
```

Os restantes endpoints exigem sessão. Para experimentar, entre com o
utilizador que criou:

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"SEU-EMAIL","password":"SUA-PASSWORD"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')

curl -H "Authorization: Bearer $TOKEN" 'http://localhost:3001/api/contacts?pageSize=3'
```

### Passo 3 — Painel

Noutro terminal:

```bash
cd wim/frontend
npm install
npm run dev
```

Abra <http://localhost:5173>. Será redireccionado para `/login`.

**Entrar:**
1. Use as credenciais do utilizador que criou no Passo 2
2. Se não criou ainda, execute `npm run create-user` no terminal do backend

**Após login, verá:**
- **Dashboard:** Cartões com números reais (urgentes, importantes, etc)
- **Atenção:** Conversas que precisam de intervenção
- **Conversas:** Listagem com filtros e paginação
- **Clientes:** Cadastro (vazio — chegará com mensagens do WhatsApp)
- **Definições:** Informações do utilizador e logout

---

## Comandos úteis

### Backend (`wim/backend`)

| Comando | O que faz |
|---|---|
| `npm run dev` | Arranca em modo desenvolvimento, recarrega ao guardar |
| `npm run build` | Compila para `dist/` |
| `npm start` | Arranca a versão compilada (produção) |
| `npm test` | Corre todos os testes |
| `npm run lint` | Procura problemas no código |
| `npm run migrate` | Aplica as migrações pendentes |
| `npm run migrate:status` | Mostra o que está aplicado e o que falta |
| `npm run seed` | Insere dados de exemplo (recusa correr em produção) |
| `npm run setup:env` | Cria o `.env` com os segredos de sessão gerados |
| `npm run create-user` | Cria um utilizador do painel |

### Painel (`wim/frontend`)

| Comando | O que faz |
|---|---|
| `npm run dev` | Arranca o painel em desenvolvimento |
| `npm run build` | Gera a versão final para publicar |
| `npm run preview` | Vê a versão final localmente |
| `npm run typecheck` | Verifica tipos TypeScript |

---

## Quando alguma coisa corre mal

### «Configuração inválida — o servidor não pode arrancar»

É o comportamento correcto: falta uma variável no `.env`. A mensagem diz
exactamente qual. Compare o seu `.env` com o `.env.example`.

### «Não foi possível ligar à base de dados»

O PostgreSQL não está a correr, ou o `DATABASE_URL` está errado.

```bash
# Confirmar se está a correr
pg_isready

# Arrancar (Linux)
sudo systemctl start postgresql
```

### «É necessário iniciar sessão» (401)

É o comportamento correcto desde a FASE 4: a API exige sessão. Entre com
`POST /api/auth/login` e envie o token no cabeçalho `Authorization`.
Ver [`05-SEGURANCA.md`](./05-SEGURANCA.md).

### «Demasiadas tentativas falhadas» (429)

Protecção contra quem tenta adivinhar passwords: 8 falhas na mesma conta em
15 minutos bloqueiam a entrada. Espere, ou — se a equipa toda sai pelo mesmo
IP — suba `LOGIN_RATE_LIMIT_MAX` no `.env`.

### Esqueci-me da password

Não há recuperação por e-mail. Peça a outro administrador que crie uma conta
nova, ou crie-a no servidor com `npm run create-user`.

### O painel mostra «Sem ligação»

O backend não está a correr. Volte ao Passo 2 e confirme que
`curl http://localhost:3001/api/health` responde.

### Os testes falham com «Recusado: … terminada em "_test"»

É uma protecção deliberada. Os testes só correm contra uma base de dados cujo
nome termine em `_test`, para nunca apagarem dados reais. Confirme que a base
`wim_test` existe.

---

## Regras que não devem ser quebradas

1. **O ficheiro `.env` nunca vai para o Git.** Já está no `.gitignore`.
   Se alguma vez uma chave for para o repositório, tem de ser revogada e
   substituída — não basta apagar o ficheiro.
2. **Não editar uma migração já aplicada.** Crie uma nova (`002_...`). O
   sistema detecta alterações e avisa, mas é melhor não chegar aí.
3. **Não apontar os testes para a base de dados real.**
4. **Não expor o sistema sem HTTPS.** Sem TLS, os tokens de sessão viajam em
   claro e qualquer pessoa na mesma rede os pode copiar.

---

## O que vem a seguir

| Fase | O que traz |
|---|---|
| ~~2~~ | ~~Tabelas de contactos, conversas, mensagens, análises e rascunhos~~ ✔ |
| ~~3~~ | ~~API base (contactos, conversas, mensagens, pesquisa)~~ ✔ |
| ~~4~~ | ~~Login e permissões~~ ✔ |
| ~~5~~ | ~~Painel com dados a sério, ecrã de entrada e navegação~~ ✔ |
| ~~6~~ | ~~Webhook do WhatsApp com validação HMAC e idempotência~~ ✔ |
| ~~7~~ | ~~Análise de mensagens com Claude (intent, priority, urgency, actions)~~ ✔ |
| 8 | Geração de rascunhos automáticos com aprovação |
| 9 | Envio de mensagens ao WhatsApp |
| 10+ | Notificações, follow-ups, automações avançadas, testes, deploy |
