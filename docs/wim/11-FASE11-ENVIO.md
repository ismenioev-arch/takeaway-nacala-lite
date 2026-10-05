# Fase 11 — Aprovar e enviar

Até aqui o WIM era um sistema de leitura: recebia, classificava, propunha.
Esta fase é a que o faz falar. É também a primeira em que um erro nosso
chega ao telemóvel de um cliente, e o desenho reflecte isso.

---

## 1. A regra que não se negoceia

> A IA recomenda, a pessoa decide.

Não existe neste código nenhum caminho que envie uma mensagem sem um
utilizador autenticado. E mesmo que existisse, a base de dados recusava:

```sql
CONSTRAINT ai_drafts_approved_requires_human
  CHECK (status <> 'APPROVED' OR approved_by_user_id IS NOT NULL)
```

Há dois testes que tentam exactamente isso — aprovar e marcar como enviado
por SQL directo, sem passar pela aplicação — e ambos esperam que a
escrita falhe. A regra está em dois sítios de propósito: a aplicação pode
ter um bug, a constraint não.

---

## 2. Porque é que se grava antes de enviar

O envio são três transacções:

| | O quê | Porquê separada |
|---|---|---|
| **A** | Aprova o rascunho e insere a mensagem `OUTBOUND` com `status='APPROVED'` e `wa_message_id` nulo. **Commit.** | Para que exista registo antes de a mensagem poder existir no mundo. |
| **B** | Chamada à Graph API. | Rede. Nunca dentro de uma transacção aberta. |
| **C** | Grava o `wamid`, põe tudo `SENT`, actualiza a conversa. | Ou, se falhou, grava o erro e notifica. |

A ordem é deliberada. Entre gravar primeiro e enviar primeiro:

- **Gravar primeiro** e falhar deixa uma linha `APPROVED` sem `wamid`.
  Estranha, visível, investigável.
- **Enviar primeiro** e falhar deixa uma mensagem no telemóvel do cliente
  de que não há registo nenhum. Ninguém descobre, até o cliente responder
  a uma coisa que o painel não mostra.

A linha `OUTBOUND` sem `wa_message_id` é legítima porque a constraint
`messages_inbound_requires_wa_id` só se aplica a mensagens recebidas — e
o índice único da coluna aceita vários nulos.

Manter a transacção aberta durante a chamada HTTP seria a terceira opção,
e a pior: uma transacção presa durante quinze segundos num pool pequeno
chega para bloquear o resto do sistema.

---

## 3. Dois cliques ao mesmo tempo

Duas pessoas no painel, ou um duplo clique impaciente. Sem defesa, as duas
leem `DRAFT`, as duas acham que podem, e o cliente recebe a mesma resposta
duas vezes.

A defesa é um `SELECT ... FOR UPDATE` logo à entrada da transacção A. O
segundo pedido espera, lê `APPROVED`, e recebe `409`. Há um teste que
dispara os dois pedidos em paralelo e exige `[200, 409]` e **uma só**
chamada ao emissor.

---

## 4. Quando a Meta recusa

Duas famílias de falha, tratadas de maneira diferente porque pedem acções
diferentes de quem está no painel:

| | Quando | Resposta | O que a pessoa lê |
|---|---|---|---|
| `SendTransientError` | 429, 5xx, rede, JSON inválido, `wamid` em falta | `503` | «Tente de novo daqui a pouco.» |
| `SendPermanentError` | 401, 400 (com o código da Meta) | `502` | «É preciso resolver isto antes de tentar outra vez.» |

Em ambos os casos **nada desaparece**: a mensagem fica `FAILED` com o
código e o detalhe, o rascunho também, e nasce uma notificação
`SEND_FAILED` ligada à conversa. A aprovação continua registada com o nome
de quem a deu — foi uma decisão tomada, independentemente do resultado.

Um rascunho `FAILED` pode ser reenviado: cria uma linha de mensagem nova. O
índice único parcial só cobre `DRAFT|EDITED|APPROVED`, por isso não
estorva.

---

## 5. O texto da IA nunca é alterado

A edição humana vai para `edited_content`; `content` fica intacto. Não é
escrúpulo de arquivo: é a única forma honesta de, daqui a seis meses,
responder à pergunta «a IA está a ajudar ou a dar trabalho?». Se o texto
original for substituído, essa pergunta deixa de ter dados.

O painel envia o texto que está no ecrã quando ele difere do guardado —
evita o caso de alguém escrever, não carregar em *Guardar*, e enviar a
versão antiga.

---

## 6. O ecrã

`/aprovacoes` foi desenhado à volta de uma pergunta: *posso decidir isto
sem abrir mais nada?* Cada cartão mostra a mensagem do cliente, o que a IA
percebeu (resumo, motivo da urgência, sugestão) e o texto proposto já
dentro de uma caixa editável.

Os três botões: **Cancelar** e **Guardar alteração** à esquerda, **Enviar
ao cliente** à direita e sozinho — é o único que não tem volta.

Quando `WHATSAPP_ENABLED` é falso, o painel di-lo em cima e desactiva o
botão. Mais vale dizê-lo antes de alguém escrever uma resposta para depois
falhar.

---

## 7. O que ficou de fora

- **Promoção automática dos rascunhos `AUTO`.** Hoje até esses esperam por
  uma pessoa. É intencional: só depois de o conjunto de avaliação mostrar
  ≥90% de acerto faz sentido deixar sair alguma coisa sozinha.
- **Reenvio automático das falhas passageiras.** Por agora quem carrega
  outra vez é a pessoa.

---

## 8. Ver a funcionar

Ver [`wim/demo/README.md`](../../wim/demo/README.md). O duplo da Meta
recusa o número `258840000000`, o que permite exercitar o caminho da falha
sem esperar que a Meta falhe sozinha.
