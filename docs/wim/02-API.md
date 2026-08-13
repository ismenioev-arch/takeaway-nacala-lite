# WIM — API REST

> **Estado:** FASE 4 concluída. 24 endpoints de autenticação, utilizadores,
> contactos, conversas, mensagens e pesquisa.
>
> **Todos exigem sessão iniciada**, excepto `/api/health` e as rotas de
> entrada. Ver [`05-SEGURANCA.md`](./05-SEGURANCA.md).

---

## 1. Como está organizado

Quatro camadas, cada uma com uma responsabilidade só:

```
Controller   → HTTP: valida a entrada, chama o serviço, escolhe o código
   ↓
Service      → regras de negócio e auditoria
   ↓
Repository   → o único sítio onde há SQL
   ↓
PostgreSQL
```

E, atravessando tudo:

- **DTO** — traduz `snake_case` da base de dados para `camelCase` da API.
  A tradução acontece num sítio só; mudar uma coluna não chega ao painel.
- **Validator** — schemas Zod. Nada entra sem passar por aqui.

---

## 2. Formato das respostas

### Listagens

```json
{
  "data": [ ... ],
  "pagination": {
    "page": 1, "pageSize": 25, "total": 42,
    "totalPages": 2, "hasNext": true, "hasPrevious": false
  }
}
```

### Erros

Sempre a mesma forma, com um `requestId` que aparece também nos logs:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Os dados enviados são inválidos.",
    "details": [
      { "field": "phone", "message": "deve estar em formato internacional, por exemplo +258840001234" }
    ],
    "requestId": "req-3"
  }
}
```

| Código | Quando |
|---|---|
| `VALIDATION_ERROR` (400) | Entrada inválida — `details` diz que campo e porquê |
| `UNAUTHORIZED` (401) | Sem sessão, ou sessão inválida/expirada |
| `FORBIDDEN` (403) | Sem permissão para esta operação |
| `TOO_MANY_ATTEMPTS` (429) | Demasiadas tentativas de entrada falhadas |
| `NOT_FOUND` (404) | O recurso não existe |
| `CONFLICT` (409) | A operação choca com o estado actual |
| `INVALID_JSON` (400) | O corpo não é JSON válido |
| `INTERNAL_ERROR` (500) | Erro nosso. Em produção não revela detalhes |

Datas viajam sempre em **ISO 8601 UTC**.

---

## 3. Endpoints

### Autenticação (secção 25)

| Método | Rota | Sessão? |
|---|---|---|
| `POST` | `/api/auth/login` | pública |
| `POST` | `/api/auth/refresh` | pública |
| `POST` | `/api/auth/logout` | pública |
| `GET` | `/api/auth/me` | exigida |
| `POST` | `/api/auth/change-password` | exigida |
| `POST` | `/api/auth/logout-all` | exigida |
| `GET` | `/api/users` | `ADMIN` |
| `POST` | `/api/users` | `ADMIN` |

O login devolve `accessToken` (15 minutos), `refreshToken` (30 dias) e
`expiresIn`. Em cada pedido:

```
Authorization: Bearer <accessToken>
```

Detalhes de rotação, detecção de roubo e travão de força bruta em
[`05-SEGURANCA.md`](./05-SEGURANCA.md).

### Contactos (secção 13)

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/contacts` | Lista com filtros, pesquisa e paginação |
| `GET` | `/api/contacts/:id` | Um contacto |
| `POST` | `/api/contacts` | Cria (201) |
| `PATCH` | `/api/contacts/:id` | Actualiza os campos indicados |
| `DELETE` | `/api/contacts/:id` | Apaga (204) — **exige `ADMIN`** |

**Filtros:** `q`, `category` (repetível), `page`, `pageSize`,
`sortBy` (`lastContactAt` \| `firstContactAt` \| `name`), `sortDirection`.

```
GET /api/contacts?q=macuácua&category=CLIENTE&category=PROSPECT&pageSize=10
```

Notas:

- `waId` é derivado do telefone quando não é indicado, para que um contacto
  criado à mão se ligue sozinho à primeira mensagem que chegar dessa pessoa.
- `phone` e `waId` **não** são actualizáveis: são a identidade do contacto, e
  mudá-los partiria a ligação ao WhatsApp. Enviá-los num `PATCH` é ignorado.
- Criar um contacto repetido devolve **409**, não um erro de base de dados.

### Conversas (secções 9 a 12, 22)

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/conversations` | Lista com todos os filtros da secção 12 |
| `GET` | `/api/conversations/attention` | **«Precisa da Minha Atenção»** (secção 10) |
| `GET` | `/api/conversations/counts` | Cartões do painel (secção 9) |
| `GET` | `/api/conversations/:id` | Uma conversa |
| `PATCH` | `/api/conversations/:id` | Estado, prioridade, assunto |
| `POST` | `/api/conversations/:id/resolve` | Marca como resolvida |
| `POST` | `/api/conversations/:id/reopen` | Reabre |
| `POST` | `/api/conversations/:id/read` | Põe as não lidas a zero |

**Filtros:** `q`, `status`, `priority`, `intent` (todos repetíveis),
`contactId`, `tagId`, `unanswered`, `awaitingApproval`, `resolved`,
`dateFrom`, `dateTo`, `sortBy`, `sortDirection`, `page`, `pageSize`.

```
GET /api/conversations?resolved=false&unanswered=true&priority=URGENTE
```

Cada item traz, numa só ida à base de dados: o contacto, a última análise da
IA (resumo, intenção, motivo da urgência, acção recomendada), o número de
rascunhos por decidir e o início da última mensagem.

### Mensagens (secção 11)

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/messages` | Histórico. Exige `conversationId`, `contactId` ou `q` |
| `GET` | `/api/messages/:id` | Uma mensagem com o seu contexto |

Cada mensagem traz a **análise da IA** e o **rascunho activo**, se existirem —
é o que a interface da conversa mostra lado a lado.

O rascunho inclui:

- `content` — o que a IA propôs (nunca é alterado);
- `editedContent` — o que a pessoa escreveu, se editou;
- `effectiveContent` — o que seria enviado;
- `requiresApproval` — `true` para tudo o que não é nível `AUTO`.

### Pesquisa global (secção 30)

| Método | Rota |
|---|---|
| `GET` | `/api/search?q=...&limit=10` |

Procura em contactos, conversas e mensagens **em paralelo**, e devolve as três
listas. Nos resultados de mensagens o `excerpt` mostra o texto à volta da
ocorrência, não o início da mensagem.

---

## 4. Decisões que vale a pena conhecer

### Ordenar por prioridade tem um sentido só

Ordenar por prioridade «descendente» poria as conversas normais no topo — o
contrário do que qualquer pessoa espera. Por isso `sortDirection` **não tem
valor por omissão**: quando não é indicado, o serviço escolhe `asc` para
prioridade (urgentes primeiro) e `desc` para datas (mais recentes primeiro).

Quem indicar o sentido explicitamente manda.

### Resolver não se faz por `PATCH`

`PATCH { "status": "RESOLVED" }` é **recusado com 400** e a mensagem aponta
para `POST /:id/resolve`. Razão: a base de dados exige `resolved_at`
preenchido, e um `PATCH` deixá-lo-ia vazio — o utilizador veria um erro de
constraint em vez de uma explicação.

### Reabrir explica o conflito

Só pode existir uma conversa aberta por contacto. Reabrir uma antiga quando já
há outra em curso devolve **409 com o identificador da conversa aberta**, em
vez do erro cru de índice único.

### Uma lista, uma consulta

A listagem de conversas usa `LEFT JOIN LATERAL` para trazer a análise mais
recente, a última mensagem e a contagem de rascunhos. Sem isso, uma página de
25 conversas custaria mais de cem consultas.

### 404 e não lista vazia

Pedir mensagens de uma conversa inexistente devolve **404**. Uma lista vazia
seria indistinguível de «a conversa existe mas ainda não tem mensagens».

---

## 5. Segurança da camada de dados

### Injecção de SQL

Nenhum valor entra na string da consulta. As condições escrevem-se com `?` e a
classe `Conditions` troca cada `?` pelo `$n` correspondente, guardando o valor
à parte:

```ts
conditions.add('c.priority = ANY(?)', ['URGENTE']);
// → WHERE c.priority = ANY($1)   valores: [['URGENTE']]
```

Um desencontro entre marcadores e valores **lança erro** em vez de produzir uma
consulta com parâmetros trocados, que devolveria dados errados em silêncio.

### Ordenação

A coluna de ordenação faz parte da estrutura da consulta e não pode ser
parametrizada. Por isso vem sempre de uma **lista fechada** — `?sortBy=` com um
valor não permitido é recusado com 400 pelo validador, e o repositório recusa
outra vez, por precaução.

### Curingas do `LIKE`

Parametrizar impede injecção, mas dentro de um `LIKE` os caracteres `%` e `_`
continuam a ser curingas. Sem os escapar, pesquisar **«50%» devolveria a base
de dados inteira**. A função `likePattern()` escapa `%`, `_` e `\` antes de
montar o padrão.

### Limites

- `pageSize` máximo de 100 — um pedido não consegue arrastar tudo.
- Corpo máximo de 1 MB.
- `rate limit` global, aplicado também às rotas inexistentes.

---

## 6. Auditoria (secção 24)

Estas acções ficam registadas com valor antigo e novo:

| Acção | Quando |
|---|---|
| `contact.created` | Contacto criado |
| `contact.updated` | Contacto alterado |
| `contact.deleted` | Contacto apagado (gravado **antes** de apagar) |
| `conversation.updated` | Estado, prioridade ou assunto alterados |
| `conversation.resolved` | Conversa resolvida |
| `conversation.reopened` | Conversa reaberta |

Um `PATCH` que não muda nada **não** gera registo.

Desde a FASE 4, cada registo guarda **quem** fez a acção, além do endereço e
do cliente. As acções de autenticação (`auth.login`, `auth.login_failed`,
`auth.refresh_reuse_detected`, …) estão em [`05-SEGURANCA.md`](./05-SEGURANCA.md).

---

## 7. O que ainda não existe

- Sem envio de mensagens: `POST /api/messages/send` e a aprovação de rascunhos
  dependem do WhatsAppService (fases 6 e 11).
- Sem endpoints de definições, métricas, notificações e follow-ups.
- Sem tempo real (SSE) — o painel faz sondagem por agora.

---

## 8. Experimentar

```bash
cd wim/backend
npm run setup:env       # gera os segredos de sessão
npm run migrate && npm run seed
npm run create-user     # o primeiro fica OWNER
npm run dev
```

```bash
# 1. entrar e guardar o token
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"SEU-EMAIL","password":"SUA-PASSWORD"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')

# 2. usar a API
curl -H "Authorization: Bearer $TOKEN" 'http://localhost:3001/api/contacts?pageSize=3'
curl -H "Authorization: Bearer $TOKEN" 'http://localhost:3001/api/conversations/counts'
curl -H "Authorization: Bearer $TOKEN" 'http://localhost:3001/api/search?q=cimentos'
```
