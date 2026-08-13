# WIM — Base de dados

> **Estado:** FASE 2 concluída. 18 tabelas, 13 tipos enumerados, 58 índices,
> 47 constraints CHECK, 22 chaves estrangeiras, 13 gatilhos.
> Aplicada e testada contra PostgreSQL 16.

---

## 1. Ideia central

**As regras que não podem falhar estão escritas na base de dados, não apenas
no código.**

Um erro num serviço, um script mal escrito ou um `UPDATE` feito à mão não
conseguem quebrá-las. Duas em particular:

| Regra | Onde vive |
|---|---|
| A mesma mensagem nunca é processada duas vezes (secção 16) | `UNIQUE` em `messages.wa_message_id` |
| A IA recomenda; o humano aprova (secções 3 e 8) | Constraints CHECK em `ai_drafts` |

Ambas têm testes que tentam quebrá-las por SQL directo, ignorando a aplicação.

---

## 2. Mapa das tabelas

```
users ─────┬──< ai_drafts.approved_by      (RESTRICT — ver §5)
           ├──< audit_logs.user_id         (RESTRICT)
           ├──< conversations.resolved_by  (SET NULL)
           └──< messages.sent_by_user_id   (SET NULL)

contacts ──┬──< conversations ──┬──< messages ──┬──1 message_analysis
           │                    │               └──< ai_drafts
           │                    ├──< conversation_tags >── tags
           │                    ├──< follow_ups
           │                    └──< notifications
           └──< messages (ligação directa, para pesquisa)

company_profile (uma linha)
company_services ──< company_prices
company_faqs

webhook_events   (idempotência de 2.ª camada)
settings         (configuração não-secreta)
schema_migrations
```

---

## 3. Idempotência (secção 16)

Três camadas, da mais forte para a mais fraca:

### Camada 1 — `messages.wa_message_id UNIQUE`

O webhook insere assim:

```sql
INSERT INTO messages (conversation_id, contact_id, direction, wa_message_id, body)
VALUES ($1, $2, 'INBOUND', $3, $4)
ON CONFLICT (wa_message_id) DO NOTHING
RETURNING id;
```

Se não devolver linha, a mensagem já existia → o processamento pára ali.

Isto é imposto pelo PostgreSQL, não pela aplicação. A diferença importa: uma
verificação em código (`SELECT` e depois `INSERT`) falha quando dois pedidos
chegam ao mesmo tempo. **O teste `resiste a 10 entregas simultâneas` prova que
dez inserções em paralelo produzem exactamente uma linha.**

A coluna é `NULL` apenas em mensagens de saída ainda não entregues à Meta —
o PostgreSQL permite vários `NULL` num índice único, o que torna isto possível
sem enfraquecer a garantia.

Uma mensagem **recebida** sem identificador é recusada
(`messages_inbound_requires_wa_id`): sem ele não há como garantir idempotência.

### Camada 2 — `webhook_events UNIQUE (provider, external_id)`

Apanha o reenvio do payload inteiro antes de qualquer processamento, e guarda
o evento bruto para diagnóstico. A unicidade é por fornecedor, para que um
futuro segundo canal não colida.

### Camada 3 — estado da mensagem

Uma mensagem já `ANALYZED` nunca volta a ser enviada à IA.

---

## 4. A regra de segurança da IA (secções 3, 7 e 8)

### As duas constraints de `ai_drafts`

```sql
-- REGRA 1: "aprovado" significa "um humano aprovou".
CHECK (status <> 'APPROVED'
       OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL))

-- REGRA 2: só o nível AUTO pode ser enviado sem aprovação humana.
CHECK (status <> 'SENT'
       OR automation_level = 'AUTO'
       OR approved_by_user_id IS NOT NULL)
```

Consequência prática: um orçamento, um pagamento ou uma reclamação
(classificados como `DRAFT` ou `HUMAN_REQUIRED`) **não conseguem** chegar ao
estado `SENT` sem um utilizador identificado. Nem por engano, nem por bug.

### O texto original da IA nunca é alterado

`content` guarda o que a IA propôs e é imutável. Se o humano editar, a edição
vai para `edited_content`. Assim é sempre possível comparar o que a IA sugeriu
com o que foi realmente enviado — que é como se percebe, ao fim de uns meses,
se a IA está a ajudar ou a atrapalhar.

### Um rascunho pendente de cada vez

Índice único parcial sobre `message_id` para os estados `DRAFT`, `EDITED` e
`APPROVED`. Evita mostrar ao utilizador duas sugestões concorrentes para a
mesma mensagem. Depois de `CANCELLED` ou `SENT`, pode existir outro.

### Preços: `is_authorized_for_ai`

```sql
is_authorized_for_ai boolean NOT NULL DEFAULT false
```

**Falso por omissão, de propósito.** Um preço acrescentado à pressa nunca fica
exposto por esquecimento. A consulta que alimenta o prompt filtra por esta
coluna, e o resto da tabela é invisível para a IA.

### Uma urgência tem de dizer porquê

```sql
CHECK (priority <> 'URGENTE' OR btrim(coalesce(urgency_reason, '')) <> '')
```

O painel mostra o motivo ao utilizador (secção 10). Uma urgência sem motivo
não o ajuda a decidir em dez segundos.

---

## 5. Apagar utilizadores: `RESTRICT`, não `SET NULL`

`ai_drafts.approved_by_user_id` e `audit_logs.user_id` usam `ON DELETE RESTRICT`.

**Porquê:** com `SET NULL`, apagar um utilizador deixaria um rascunho
«aprovado por ninguém» — e a REGRA 1 acima passaria a impedir apagar esse
utilizador, com um erro incompreensível. Pior: um registo de auditoria sem
autor deixa de ser auditoria.

**Como se faz então:** um utilizador que já aprovou respostas **desactiva-se**
(`is_active = false`), não se apaga. O histórico continua a apontar para uma
pessoa real.

As restantes referências a `users` (`conversations.resolved_by`,
`messages.sent_by_user_id`) usam `SET NULL`, porque nada depende delas.

Contactos são diferentes: apagar um contacto apaga em cascata as suas
conversas, mensagens, análises e rascunhos — é o comportamento esperado de um
pedido de eliminação de dados pessoais.

---

## 6. Uma conversa aberta por contacto

```sql
CREATE UNIQUE INDEX conversations_one_open_per_contact_idx
  ON conversations (contact_id)
  WHERE status NOT IN ('RESOLVED', 'ARCHIVED');
```

Enquanto houver uma conversa por resolver com o João, tudo o que ele escrever
entra nessa conversa. Depois de resolvida, a mensagem seguinte abre uma nova.
Isto evita o caso em que o painel mostra três conversas abertas com a mesma
pessoa e o utilizador não sabe qual abrir.

---

## 7. Ordenação por prioridade sem `CASE`

O tipo `message_priority` foi declarado nesta ordem:

```sql
CREATE TYPE message_priority AS ENUM ('URGENTE', 'IMPORTANTE', 'ACOMPANHAR', 'NORMAL');
```

A ordenação natural de um `ENUM` no PostgreSQL é a ordem da declaração, por
isso `ORDER BY priority` já coloca as urgências no topo — sem `CASE`, sem
tabela auxiliar, e usando o índice. O requisito visual da secção 28 está
dentro do próprio tipo.

Do lado do TypeScript, `highestPriority()` (em `src/models/enums.ts`) aplica a
mesma ordem: uma conversa urgente não desce para normal só porque a mensagem
seguinte foi um «obrigado».

---

## 8. Auditoria imutável (secção 24)

`audit_logs` tem um gatilho que recusa `UPDATE` e `DELETE`:

```sql
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_forbid_change();
```

`user_id` a `NULL` significa «acção do sistema» — por exemplo, uma resposta
automática de nível 1.

---

## 9. Pesquisa global (secção 30)

`contacts.search_text` é uma coluna **calculada pelo PostgreSQL** que junta
nome, nome de perfil, empresa e telefone. Nunca fica dessincronizada porque
não é a aplicação que a mantém.

```sql
CREATE INDEX contacts_search_idx ON contacts USING gin (search_text gin_trgm_ops);
CREATE INDEX messages_body_search_idx ON messages USING gin (body gin_trgm_ops);
```

Os índices `gin_trgm_ops` suportam pesquisa parcial (`ILIKE '%nhantumbo%'`)
sem varrer a tabela inteira.

---

## 10. Índices que o painel precisa

| Índice | Para que consulta |
|---|---|
| `conversations_triage_idx` | O painel: urgências primeiro, recentes no topo |
| `conversations_one_open_per_contact_idx` | Regra de uma conversa aberta |
| `messages_conversation_idx` | Histórico de uma conversa |
| `messages_pending_analysis_idx` | Fila da IA: recebidas por analisar |
| `ai_drafts_pending_idx` | «A aguardar aprovação» |
| `notifications_unread_idx` | O sino das notificações |
| `follow_ups_due_idx` | «Que lembretes vencem hoje?» |
| `webhook_events_invalid_signature_idx` | Tentativas de acesso indevido |
| `company_prices_authorized_idx` | Preços que a IA pode ver |

Vários são **índices parciais** (`WHERE …`): só indexam as linhas que
interessam, ficam pequenos e mantêm-se rápidos mesmo com muito histórico.

---

## 11. Comandos

```bash
cd wim/backend

npm run migrate          # aplica as migrações pendentes
npm run migrate:status   # mostra o estado, sem alterar nada
npm run seed             # dados de exemplo (recusa correr em produção)
npm test                 # 143 testes, incluindo os de integração
```

### Regras das migrações

1. **Nunca editar uma migração já aplicada em produção.** Criar uma nova.
   O sistema guarda o checksum de cada uma e avisa se detectar alteração.
2. Cada migração corre dentro de uma transacção: ou aplica tudo, ou nada.
3. Correm por ordem de nome (`001`, `002`, …), uma vez cada.

---

## 12. Dados de exemplo

`npm run seed` insere um gabinete de engenharia fictício em Nacala, com
serviços, preços, FAQs, etiquetas e três contactos.

- **Recusa correr com `NODE_ENV=production`.**
- É idempotente: correr várias vezes não duplica.
- Os telefones usam um intervalo reservado e não pertencem a ninguém.
- Dos quatro preços, **apenas dois estão autorizados para a IA** — os outros
  dependem de negociação, e servem de exemplo vivo da secção 7.

---

## 13. O que a FASE 2 deliberadamente não faz

- Não cria repositórios nem endpoints — isso é a FASE 3.
- Não implementa autenticação — é a FASE 4.
- Não chama a Meta nem a Claude.

As tabelas `webhook_events` e `message_analysis` existem e estão testadas, mas
quem as vai preencher só chega nas fases 6 a 8.
