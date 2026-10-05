# WIM — FASES 6 e 7: Recepção de mensagens do WhatsApp

> **Estado:** concluído. O sistema recebe mensagens reais da WhatsApp
> Business Cloud API, guarda-as como contactos, conversas e mensagens, e
> acompanha o estado de entrega das respostas que enviarmos.

---

## 1. O caminho de uma mensagem

```
  Cliente escreve no WhatsApp
          │
          ▼
  ┌───────────────┐
  │     Meta      │  POST assinado com HMAC-SHA256
  └───────┬───────┘
          ▼
  POST /api/webhooks/whatsapp
          │
          ├─ 1. integração ligada?        não → 503
          ├─ 2. assinatura válida?        não → 401
          ├─ 3. forma reconhecível?       não → 200 + log
          │
          ▼
  Para cada mensagem do lote:
          ├─ 4. reservar o evento (wamid)  já processado → ignorar
          ├─ 5. transacção:
          │       contacto → conversa → mensagem → não lidas
          └─ 6. marcar o evento como processado
          │
          ▼
       200 OK
```

Os seis passos são independentes e nenhum confia no anterior ter corrido
bem. É isso que permite responder honestamente à única pergunta que
interessa: *a mensagem daquele cliente está guardada, ou não?*

---

## 2. As quatro garantias

### 2.1 Nenhuma mensagem é atribuída ao cliente errado

Um lote da Meta traz duas listas em paralelo: `contacts` (quem escreveu) e
`messages` (o que escreveram). Cada mensagem identifica o seu autor no campo
`from`, e é por aí que se ligam.

A implementação anterior percorria as duas listas uma dentro da outra —
contactos × mensagens. Num lote com dois clientes e três mensagens produzia
seis combinações, e atribuía as mensagens de um ao outro. Em hora de ponta,
quando a Meta junta várias mensagens no mesmo pedido, isso seria o caso
normal e não a excepção.

### 2.2 Nenhuma mensagem aparece duas vezes

A Meta reenvia o lote até sete vezes se não receber `200` depressa. Há duas
barreiras, e ter as duas não é exagero:

| Barreira | Protege contra |
|---|---|
| `webhook_events (provider, external_id)` | o mesmo evento entregue outra vez |
| `messages.wa_message_id UNIQUE` | a mesma mensagem a chegar por outro caminho |

A reserva do evento é **um único comando SQL** — `INSERT … ON CONFLICT` —
e não um «verificar e depois inserir». Entre essas duas operações caberia um
segundo pedido, e com reenvios em paralelo isso acontece mesmo.

O `ON CONFLICT` não é um `DO NOTHING` simples: permite reclamar de novo um
evento que **falhou**, ou que ficou encravado em `PENDING` há mais de cinco
minutos (o processo morreu a meio). Sem essa parte, uma indisponibilidade de
um segundo na base de dados transformaria aquela mensagem numa perda
definitiva — todas as tentativas seguintes seriam tratadas como duplicados.

### 2.3 Nenhum tipo novo faz perder as mensagens que vinham com ele

A Meta acrescenta tipos de mensagem sem avisar. O validador anterior aceitava
apenas `text`: um autocolante no meio do lote fazia a validação recusar o
lote **inteiro**, e as mensagens legítimas desapareciam com ele — em
silêncio, porque o webhook responde `200` na mesma.

Agora `type` é uma string livre e a interpretação acontece em
`normalizeMessage`, uma função pura e testada caso a caso:

| O que o cliente envia | Como fica guardado |
|---|---|
| Texto | `text`, com o corpo |
| Imagem, vídeo, áudio, documento, autocolante | o tipo, com `media_id` para ir buscar o ficheiro; corpo = legenda, ou uma descrição («Enviou uma mensagem de voz») |
| Localização | `location`, com nome e coordenadas legíveis |
| Contacto partilhado, botão, lista | o tipo, com a escolha feita |
| Reacção | `unsupported`, «Reagiu com 👍» |
| **Tipo desconhecido** | `unsupported`, «Mensagem do tipo "X", ainda não suportada» |

O corpo nunca fica vazio. Quem está ao balcão prefere ler «Enviou uma
localização» a ver uma linha em branco e julgar que o cliente desistiu.

### 2.4 Nunca fica meia conversa na base de dados

Contacto, conversa, mensagem e contador de não lidas entram na mesma
transacção. Uma falha a meio não deixa uma conversa criada e vazia no
painel.

E cada mensagem é uma unidade independente: uma falha na terceira não impede
as outras quatro de serem guardadas. No fim, se alguma falhou, o erro sobe,
o webhook devolve `500`, a Meta reenvia — e só as que faltam são
processadas.

---

## 3. Estados de entrega

A Meta avisa o que aconteceu às mensagens que **nós** enviámos:
`sent` → `delivered` → `read`, ou `failed`.

Duas decisões:

- **O estado nunca recua.** A Meta não garante a ordem das notificações: o
  `read` pode chegar antes do `delivered`. Sem protecção, uma mensagem já
  lida voltaria a aparecer como «entregue» e o operador ficaria à espera de
  uma leitura que já tinha acontecido. `failed` é a excepção e aplica-se
  sempre.
- **A chave de idempotência inclui o estado** (`wamid.X:DELIVERED`). A mesma
  mensagem recebe três notificações e as três têm de passar.

Estados sem significado para nós, como `accepted`, são ignorados sem sequer
ocupar espaço na tabela de eventos.

---

## 4. Segurança

| Verificação | Onde | Se falhar |
|---|---|---|
| Integração ligada (`WHATSAPP_ENABLED`) | `onRequest` | **503**, a dizer porquê |
| Assinatura HMAC-SHA256 do corpo | `preHandler` | **401** |
| Token de verificação (handshake) | rota `GET` | **401** |

A assinatura é calculada sobre os **bytes exactos** que a Meta enviou. É por
isso que existe o `raw-body` middleware: ler o JSON, voltar a serializá-lo e
assinar isso daria um hash diferente — a reserialização muda espaços, ordem
de chaves e escapes.

O token de verificação é comparado em tempo constante. Um `!==` devolveria
a resposta mais depressa quanto mais cedo os caracteres divergissem, e isso
chega para o adivinhar carácter a carácter.

Tentativas com assinatura inválida ficam registadas com
`signature_valid = false`. A migração criou um índice só para elas: são
sinal de abuso e têm de ser fáceis de encontrar.

---

## 5. Porque é que o webhook espera

O limite da Meta são cinco segundos. A tentação é responder `200` e
processar a seguir.

Isso perde mensagens, de duas maneiras:

- numa função serverless, o processo é congelado assim que a resposta sai;
- num servidor permanente, um reinício no momento errado faz o mesmo.

Em ambos os casos já respondemos `200`, por isso a Meta considera o evento
entregue e **nunca mais o reenvia**. A mensagem do cliente desaparece sem
deixar rasto.

O que o webhook faz são algumas escritas na base de dados: dezenas de
milissegundos, muito longe dos cinco segundos. Quando a análise pela IA
entrar (FASE 8) — essa sim, lenta — o caminho certo é uma fila de trabalho.

---

## 6. Ligar à Meta

Pré-requisitos: uma app em <https://developers.facebook.com> com o produto
**WhatsApp** adicionado.

### 6.1 Variáveis de ambiente

```
WHATSAPP_ENABLED=true
WHATSAPP_APP_SECRET=...        # Definições da App → Básico → Chave Secreta
WHATSAPP_VERIFY_TOKEN=...      # inventado por si
WHATSAPP_ACCESS_TOKEN=...      # token de System User (permanente)
WHATSAPP_PHONE_NUMBER_ID=...   # WhatsApp → Configuração da API
```

Com `WHATSAPP_ENABLED=true` e alguma destas em falta, o servidor recusa
arrancar em produção e diz qual falta. O `WHATSAPP_APP_SECRET` é exigido em
qualquer ambiente: sem ele o webhook não distingue um evento verdadeiro de
um forjado.

### 6.2 Registar o endereço

Na Meta, em **WhatsApp → Configuração → Webhooks**:

| Campo | Valor |
|---|---|
| URL de callback | `https://o-seu-dominio.vercel.app/api/webhooks/whatsapp` |
| Token de verificação | o mesmo de `WHATSAPP_VERIFY_TOKEN` |
| Campos a subscrever | `messages` |

A Meta faz um `GET` com um desafio; o sistema devolve-o e o webhook fica
confirmado.

### 6.3 Confirmar que está a receber

Envie uma mensagem para o número do negócio e verifique:

```bash
curl https://o-seu-dominio.vercel.app/api/health
# "features": { "whatsapp": true, ... }
```

No painel, a conversa deve aparecer em **Conversas** em segundos.

Se não aparecer, os logs da função dizem o que aconteceu — cada lote
processado deixa uma linha com quantas mensagens foram recebidas, quantas
eram duplicados e quais falharam.

---

## 7. Testes

| Ficheiro | O que cobre |
|---|---|
| `tests/unit/whatsapp-normalize.test.ts` | cada tipo de mensagem, um a um, incluindo os que violariam as restrições do esquema |
| `tests/integration/webhook-whatsapp.test.ts` | o caminho completo: assinatura real, payloads com a forma da Meta, escrita na base de dados |

Os testes de integração assinam os pedidos com HMAC, como a Meta faz, e
verificam o que ficou guardado. Cobrem, entre outros:

- um lote com dois clientes e três mensagens, para provar que cada mensagem
  fica com o autor certo;
- o mesmo lote entregue três vezes, para provar que não duplica — nem as
  mensagens, nem o contador de não lidas;
- um tipo desconhecido no meio de uma mensagem boa, para provar que a boa
  passa;
- notificações de estado fora de ordem, para provar que o estado não recua.

---

## 8. O que vem a seguir

**FASE 8 — Análise pela IA.** Cada mensagem recebida fica com
`status = 'RECEIVED'`, e o índice `messages_pending_analysis_idx` já existe
para servir de fila. A análise sugere prioridade, intenção, resumo e acção
recomendada.

**FASE 10 — Aprovação de rascunhos** e **FASE 11 — Envio**, que fecham o
ciclo: responder ao cliente a partir do painel. A coluna `wa_message_id`
fica `NULL` até a Meta confirmar o envio, e é aí que os estados de entrega
descritos na secção 3 passam a ter uso diário.
