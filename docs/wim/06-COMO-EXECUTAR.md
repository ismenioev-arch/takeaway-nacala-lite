# WIM — Como executar

Guia passo a passo. Escrito para quem não programa: siga pela ordem.

> **Estado:** FASE 3 concluída. O sistema arranca, o modelo de dados está
> criado e testado, e a API REST de contactos, conversas, mensagens e pesquisa
> funciona. Ainda **não** tem autenticação (FASE 4) nem recebe mensagens do
> WhatsApp (fases 6 a 8).
>
> ⚠️ **Sem autenticação, não coloque isto acessível na Internet.**
>
> Ver [`01-BASE-DE-DADOS.md`](./01-BASE-DE-DADOS.md) e [`02-API.md`](./02-API.md).

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
cp .env.example .env
```

Para desenvolvimento local, o `.env` já funciona como está — a única linha
que importa nesta fase é:

```
DATABASE_URL=postgresql://wim:wim_dev_password@localhost:5432/wim
```

Criar as tabelas:

```bash
npm run migrate
```

Deve ver:

```
Aplicadas 2 migração(ões):
  ✔ 001_initial.sql
  ✔ 002_core_domain.sql
```

Opcional — inserir dados de exemplo para ver o sistema com conteúdo:

```bash
npm run seed
```

Arrancar o servidor:

```bash
npm run dev
```

Confirmar noutro terminal:

```bash
curl http://localhost:3001/api/health
curl 'http://localhost:3001/api/contacts?pageSize=3'
curl 'http://localhost:3001/api/search?q=cimentos'
```

Resposta esperada:

```json
{
  "status": "ok",
  "service": "wim-backend",
  "database": { "connected": true, "serverVersion": "PostgreSQL 16.13" }
}
```

### Passo 3 — Painel

Noutro terminal:

```bash
cd wim/frontend
npm install
npm run dev
```

Abra <http://localhost:5173>. Deve ver **«Servidor: Ligado»** a verde.

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

### Painel (`wim/frontend`)

| Comando | O que faz |
|---|---|
| `npm run dev` | Arranca o painel em desenvolvimento |
| `npm run build` | Gera a versão final para publicar |
| `npm run preview` | Vê a versão final localmente |

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

---

## O que vem a seguir

| Fase | O que traz |
|---|---|
| ~~2~~ | ~~Tabelas de contactos, conversas, mensagens, análises e rascunhos~~ ✔ |
| ~~3~~ | ~~API base (contactos, conversas, mensagens, pesquisa)~~ ✔ |
| 4 | Login e permissões |
| 5 | Painel com dados a sério |
| 6 | Webhook do WhatsApp |
| 7 | Recepção e armazenamento de mensagens |
| 8 | Análise pela IA (Claude) |
