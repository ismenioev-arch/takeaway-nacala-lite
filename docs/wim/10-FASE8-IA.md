# FASE 8 — A análise pela IA

> Da mensagem recebida ao rascunho à espera de uma pessoa.
> Implementa a secção 6.3 do [documento de arquitectura](./00-ARQUITETURA.md).

A FASE 6 trouxe as mensagens para dentro do sistema. Esta fase responde à
pergunta seguinte: **o que é que elas querem, e o que é que se responde?**

A regra que governa tudo o que está escrito aqui cabe numa frase: *a IA
recomenda, a pessoa decide.* Nenhuma resposta sai sozinha sem que o código
— não o modelo — tenha verificado, uma a uma, todas as condições que o
permitem.

---

## 1. O caminho de uma mensagem

```
  mensagem recebida (FASE 6)
      status = RECEIVED
            │
            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ 1. REIVINDICAR                                              │
  │    UPDATE … WHERE status='RECEIVED' … FOR UPDATE SKIP       │
  │    LOCKED → status = ANALYZING                              │
  │    Só um processo fica com a mensagem. Dois disparos em      │
  │    paralelo apanham mensagens diferentes.                   │
  └─────────────────────────────────────────────────────────────┘
            │
            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ 2. MONTAR O CONTEXTO — tudo da base de dados, nada do prompt │
  │    · a mensagem e as últimas N da conversa                   │
  │    · ficha do contacto e histórico                           │
  │    · empresa, horários, serviços, FAQs                       │
  │    · APENAS os preços com is_authorized_for_ai = true        │
  │    · data e hora actuais                                     │
  └─────────────────────────────────────────────────────────────┘
            │
            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ 3. CHAMAR A CLAUDE com saída estruturada                     │
  │    tools + tool_choice: a API obriga o modelo a devolver um  │
  │    objecto conforme ao schema, em vez de texto livre.        │
  └─────────────────────────────────────────────────────────────┘
            │
            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ 4. VALIDAR OUTRA VEZ, do nosso lado (Zod)                    │
  │    prioridade e intenção dentro dos valores permitidos?      │
  │    confiança entre 0 e 1? resumo não vazio?                  │
  │    URGENTE traz justificação?                                │
  │    ✘ → status = FAILED, com o motivo. Nunca grava lixo.      │
  └─────────────────────────────────────────────────────────────┘
            │
            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ 5. DECIDIR O NÍVEL DE AUTOMAÇÃO — decide o CÓDIGO            │
  │    (a matriz da secção 3 deste documento)                    │
  └─────────────────────────────────────────────────────────────┘
            │
            ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ 6. GRAVAR, tudo numa transacção                              │
  │    message_analysis + ai_drafts (status DRAFT, sempre)       │
  │    + conversa actualizada + notificação + auditoria          │
  │    status da mensagem = DRAFTED                              │
  └─────────────────────────────────────────────────────────────┘
```

**A análise nunca corre dentro do webhook.** Uma chamada à Claude demora
segundos e a Meta espera resposta em poucos; misturar as duas coisas dá
timeouts, reenvios e mensagens duplicadas. O webhook grava e responde —
isto acontece depois, noutro pedido.

---

## 2. O que a IA pode saber

O prompt não tem factos escritos lá dentro. Tudo vem da base de dados, em
cada chamada, e por isso muda-se o que a IA responde sem tocar em código.

| Fonte | Tabela | Filtro |
|---|---|---|
| Empresa, horários, políticas | `company_profile` | — |
| Serviços | `company_services` | `is_active` |
| **Preços** | `company_prices` | **`is_authorized_for_ai = true`** |
| Perguntas frequentes | `company_faqs` | `is_active` |
| Histórico da conversa | `messages` | últimas `AI_HISTORY_LIMIT` |

A linha a negrito é a mais importante do sistema. `is_authorized_for_ai` é
**falso por omissão**: um preço novo nunca aparece numa resposta por
esquecimento, só porque alguém decidiu explicitamente que podia. Quando não
há nenhum preço autorizado, o prompt diz-lho por palavras —
`Preços autorizados: NENHUM` — porque o silêncio seria interpretado como
«usa o que souberes».

Não existe, em lado nenhum do código, uma consulta de preços sem esse
filtro. Se existisse, mais cedo ou mais tarde alguém chamava a errada.

---

## 3. Quem decide se uma resposta pode sair sozinha

Decide o código, em `services/ai/automation.ts`. A função é pura: entra um
objecto, sai uma decisão e a razão por escrito. Sem base de dados, sem
rede, sem relógio — e por isso testável de forma exaustiva.

O modelo contribui com factos; o que se faz com eles está escrito aqui. A
ordem importa: **todas as recusas vêm antes da única permissão.**

```
┌─ intenção ∈ {ORCAMENTO, PAGAMENTO, COBRANCA,
│              RECLAMACAO, NEGOCIACAO, ALTERACAO_PROJETO} → HUMAN_REQUIRED
├─ OU prioridade == URGENTE                               → HUMAN_REQUIRED
├─ OU a análise concluiu que precisa de uma pessoa        → HUMAN_REQUIRED
├─ OU a resposta menciona preço, valor, desconto ou prazo → HUMAN_REQUIRED
│     (verificado duas vezes: o que o modelo admite
│      e o que o texto da resposta mostra)
│
├─ senão, se intenção ∈ {INFORMACAO, SUPORTE}
│     E confiança ≥ limiar (por omissão 0.90)
│     E os dois interruptores de automação ligados
│     E a resposta assenta em FAQs/serviços/horários registados
│     E existem mesmo factos registados onde assentar      → AUTO
│
└─ senão                                                   → DRAFT
```

Três notas sobre o porquê:

**A lista de intenções que exigem uma pessoa não é uma lista de coisas
difíceis — é uma lista de coisas caras.** Um orçamento errado é dinheiro
perdido; uma reclamação mal respondida é um cliente perdido. Em todas
elas, o custo de errar é maior do que o incómodo de esperar.

**«A resposta menciona preço ou prazo» é verificado duas vezes.** O modelo
declara-o, e o código procura no texto com expressões regulares. Se o
modelo disser que não falou de dinheiro mas escrever «5000 MT», acredita-se
no texto. Falsos positivos aqui são baratos: significam apenas que uma
pessoa lê a mensagem antes de sair.

**Mesmo no nível AUTO, o rascunho nasce com `status = 'DRAFT'`.** A
promoção para enviado é um passo separado, com registo próprio. Não existe
caminho no código que escreva um rascunho já aprovado — e as constraints
da tabela também não o permitiriam sem um utilizador identificado.

Os dois interruptores de automação têm de estar **ambos** ligados:
`settings['ai.automation_enabled']` (global) e
`company_profile.auto_reply_enabled` (o que o dono vê no painel). Qualquer
um deles desligado trava tudo.

---

## 4. Quando alguma coisa corre mal

| Situação | O que acontece | Porquê |
|---|---|---|
| Rede em baixo, tempo esgotado, 429, 5xx | Mensagem volta a `RECEIVED` | Passa com o tempo. Tenta-se outra vez. |
| Chave inválida, pedido recusado (4xx) | `FAILED`, código `AI_REQUEST_REJECTED` | Insistir não resolve. |
| Resposta que não passa na validação | `FAILED`, código `AI_INVALID_RESPONSE`, com o payload no detalhe | Repetir daria o mesmo. Passa a ser trabalho de uma pessoa. |
| Função congelada a meio (serverless) | Fica em `ANALYZING`; ao fim de 10 minutos volta à fila | Sem isto, uma mensagem perdida ficava perdida para sempre. |
| Uma mensagem problemática num lote | As outras continuam | Transacção por mensagem, falhas isoladas. |
| Falha transitória num lote | O lote pára aí | As seguintes bateriam na mesma parede. |

Uma falha transitória **pára o lote** mas não perde nada; uma falha
definitiva **marca a mensagem** e deixa-a visível. Em nenhum caso uma
mensagem desaparece em silêncio.

---

## 5. Como a fila é empurrada

A fila precisa de quem a chame, e em serverless não há processo entre
pedidos. O mesmo endereço aceita três origens:

```
POST /api/ai/analyze?limit=5     (e GET, porque o Vercel Cron só faz GET)
GET  /api/ai/queue               quantas esperam, correm, falharam
```

| Quem chama | Como se autentica |
|---|---|
| Agendador (Vercel Cron, cron-job.org, GitHub Actions) | `Authorization: Bearer <CRON_SECRET>` |
| O painel | sessão do utilizador |
| Worker interno (servidor permanente) | em processo, sem HTTP |

O segredo é comparado em tempo constante. Sem ele e sem sessão, **401** —
por GET ou por POST. Um disparador aberto ao mundo seria um orçamento
aberto ao mundo.

A resposta diz o que foi feito:

```json
{ "analyzed": 5, "retried": 0, "failed": 0, "remaining": 3 }
```

`remaining > 0` significa que vale a pena voltar já, em vez de esperar
pelo ciclo seguinte.

### Em servidor permanente (Docker, VPS)

```bash
AI_WORKER_ENABLED=true
AI_WORKER_INTERVAL_MS=15000
```

O worker processa a fila sozinho e volta imediatamente enquanto houver
trabalho. Em serverless é ignorado, com um aviso nos logs.

### Na Vercel

O `vercel.json` traz um cron diário:

```json
"crons": [{ "path": "/api/ai/analyze", "schedule": "0 5 * * *" }]
```

**É de propósito que é diário, e não de cinco em cinco minutos.** O plano
Hobby da Vercel recusa, *no momento do deploy*, qualquer agenda mais
frequente do que uma vez por dia. Uma entrada `*/5 * * * *` não ficaria
lenta — rebentaria com o deploy inteiro.

Para uma caixa de WhatsApp a sério, uma análise por dia não serve. A
solução, que funciona em qualquer plano e é gratuita, é um agendador
externo a chamar o mesmo endereço:

```
URL:     https://o-seu-dominio/api/ai/analyze
Método:  POST
Cabeçalho: Authorization: Bearer <CRON_SECRET>
Cadência:  de 2 em 2 minutos
```

Serve qualquer um: cron-job.org, GitHub Actions agendado, EasyCron. O
endpoint é o mesmo que o cron da Vercel usa, portanto não há um segundo
caminho de código por testar.

No plano Pro, basta mudar a agenda no `vercel.json` para `*/2 * * * *` e
dispensar o agendador externo. Com `CRON_SECRET` definido nas variáveis do
projecto, a Vercel envia o cabeçalho de autorização automaticamente.

---

## 6. Configuração

| Variável | Omissão | Para que serve |
|---|---|---|
| `AI_ENABLED` | `false` | Sem isto não há análise nem é preciso chave |
| `ANTHROPIC_API_KEY` | — | Obrigatória em produção com `AI_ENABLED=true` |
| `ANTHROPIC_MODEL` | `claude-opus-5` | |
| `ANTHROPIC_BASE_URL` | API da Anthropic | Só para quem usa um gateway à frente |
| `AI_EFFORT` | `medium` | Tecto de tokens por chamada |
| `AI_CONFIDENCE_THRESHOLD` | `0.9` | Valor de arranque do limiar |
| `AI_BATCH_SIZE` | `5` | Mensagens por execução da fila |
| `AI_TIMEOUT_MS` | `45000` | Tecto de tempo por chamada |
| `AI_HISTORY_LIMIT` | `10` | Mensagens anteriores no contexto |
| `CRON_SECRET` | — | Obrigatória em produção com `AI_ENABLED=true` |
| `AI_WORKER_ENABLED` | `false` | Só em servidores permanentes |

Duas definições vivem na base de dados, não no ambiente, porque são
decisões de negócio e não de infraestrutura — mudam-se sem deploy:

| Definição | Omissão | |
|---|---|---|
| `ai.automation_enabled` | `false` | Interruptor global da resposta automática |
| `ai.confidence_threshold` | `0.9` | Manda sobre a variável de ambiente |

Com `AI_ENABLED=false`, as rotas `/api/ai/*` respondem **503** com uma
mensagem que explica o que falta ligar — e não 404, que mandaria alguém
procurar um erro de configuração inexistente.

---

## 7. Testes

103 testes novos, em quatro ficheiros:

| Ficheiro | O que cobre |
|---|---|
| `tests/unit/ai-automation.test.ts` | **A matriz intenção × prioridade × confiança.** Todas as intenções, não uma amostra. |
| `tests/unit/ai-schema.test.ts` | Validação do JSON: prioridade inventada, confiança > 1, resumo vazio, URGENTE sem motivo |
| `tests/unit/ai-prompt.test.ts` | O que entra no prompt, e que os preços não autorizados não entram |
| `tests/integration/ai-analysis.test.ts` | O caminho completo contra PostgreSQL real |

A Claude não é chamada em nenhum deles: o cliente é substituído por um
duplo. O que se testa é o *nosso* código. A qualidade das respostas do
modelo é outra coisa, verificada pelo conjunto de avaliação da secção 10.3
da arquitectura, que custa dinheiro e corre à mão.

Casos que merecem destaque, porque são os que guardam a regra de
segurança:

- um orçamento com confiança **1.0** continua a ser `HUMAN_REQUIRED`;
- uma resposta que diz «7500 MT» apesar de o modelo jurar que não falou de
  preços continua a ser `HUMAN_REQUIRED`;
- `0.899` fica como rascunho, `0.900` é automático — o limiar é mesmo onde
  se diz que está;
- duas execuções da fila em paralelo analisam a mensagem **uma só vez**;
- reanalisar substitui a análise e cancela o rascunho anterior, sem nunca
  deixar dois pendentes.

---

## 8. Prova real

Com o sistema a correr em modo de produção simulado, três mensagens
entregues pelo webhook e a fila disparada por `GET /api/ai/analyze` com o
segredo do agendador:

| Mensagem | Prioridade | Intenção | Nível | Rascunho |
|---|---|---|---|---|
| «a que horas abrem no sábado?» | NORMAL | INFORMACAO | **AUTO** | DRAFT |
| «Quanto custa um projecto de uma casa?» | IMPORTANTE | ORCAMENTO | **HUMAN_REQUIRED** | DRAFT |
| «A minha obra está parada, preciso falar consigo agora.» | URGENTE | OBRA | **HUMAN_REQUIRED** | DRAFT |

O caso do meio é o que interessa: o modelo devolveu confiança **0.99** e
uma resposta que prometia «85000 MT, com entrega em duas semanas». Foi
travado por duas razões independentes — a intenção e o dinheiro no texto.
E, mesmo no caso de cima, classificado como automático, o rascunho ficou
em `DRAFT`: nada saiu sem decisão de ninguém.

As conversas subiram para `WAITING_HUMAN` e `URGENTE`, as notificações
certas apareceram (`URGENT_MESSAGE`, `APPROVAL_PENDING`), e cada decisão
ficou no registo de auditoria com a razão por escrito, em português.

---

## 9. O que vem a seguir

Esta fase pára onde o rascunho fica pronto. Falta o outro lado:

- **Envio** — aprovar, editar e enviar pela API da Meta (`SENT`,
  `sent_message_id`, o fecho do ciclo que as constraints de `ai_drafts` já
  prevêem);
- **Promoção automática** dos rascunhos `AUTO`, que hoje ficam à espera
  como os outros;
- **Transcrição de áudio**, hoje descrito ao modelo como «mensagem de voz,
  ainda não transcrita»;
- **Conjunto de avaliação** com as ~30 mensagens da secção 10.3, incluindo
  as que tentam enganar a IA.
