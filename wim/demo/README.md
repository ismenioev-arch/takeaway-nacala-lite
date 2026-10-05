# Ambiente de demonstração

Serve para ver o WIM a funcionar de ponta a ponta — webhook, análise,
aprovação e envio — **sem chaves reais e sem mandar mensagens a ninguém**.

A Anthropic e a Graph API da Meta são substituídas por duplos locais. Tudo
o resto é o código de produção: os mesmos clientes HTTP, a mesma validação,
as mesmas decisões de automação, as mesmas escritas na base de dados. A
diferença entre esta demonstração e produção são duas variáveis de
ambiente (`ANTHROPIC_BASE_URL` e `WHATSAPP_GRAPH_URL`).

## Arranque

Precisa de um PostgreSQL acessível. Depois:

```bash
cd wim
source demo/env.example.sh              # configuração da demonstração

# 1. esquema e dados de base
(cd backend && npx tsx src/database/cli.ts up)
node --import tsx demo/seed-demo.mjs

# 2. duplos da Anthropic e da Meta (porta 4100)
node demo/fake-services.mjs &

# 3. painel + API no mesmo endereço (porta 4000)
npm run build --workspace @wim/frontend
node --import tsx demo/preview.mjs &

# 4. a Meta a entregar mensagens, e a fila a analisá-las
node --import tsx demo/send-webhook.mjs
curl "http://127.0.0.1:4000/api/ai/analyze" -H "Authorization: Bearer $CRON_SECRET"
curl "http://127.0.0.1:4000/api/ai/analyze" -H "Authorization: Bearer $CRON_SECRET"
```

Entre em <http://localhost:4000> com `dono@nacala.mz` / `SenhaDemo#2026`.

## O que cada ficheiro faz

| Ficheiro | Para quê |
|---|---|
| `env.example.sh` | Configuração completa, com a IA e a Meta apontadas aos duplos. |
| `seed-demo.mjs` | Utilizador, contexto da empresa, serviços e preços, definições. |
| `fake-services.mjs` | Duplos da Anthropic (`/v1/messages`) e da Graph API (`/vXX.Y/<id>/messages`). |
| `preview.mjs` | Painel estático + API serverless no mesmo endereço, como na Vercel. |
| `send-webhook.mjs` | Lote de 10 mensagens assinadas com HMAC, como a Meta envia. |

## Porque é que o duplo da IA é como é

Duas decisões que parecem detalhe e não são:

**Responde com `tool_use`, não com texto.** O cliente real chama a API com
`tool_choice` forçado, por isso a resposta nunca vem como texto livre. Um
duplo que devolvesse texto estaria a testar um caminho que em produção não
existe.

**Os predicados olham só para a mensagem do cliente**, nunca para o prompt
inteiro — só o que vem depois de `=== MENSAGEM A ANALISAR ===`. A razão é
concreta: o prompt contém a palavra «preparadas», e
`'preparadas'.includes('parada')` é verdadeiro. Um duplo ingénuo
classificaria todas as mensagens como obra parada e daria uma demonstração
bonita e falsa.

## O lote de mensagens

As dez mensagens cobrem de propósito os casos que partem sistemas mal
feitos: uma imagem, uma localização, e um tipo (`ordem_de_compra_v9`) que
não existe no WhatsApp. O sistema tem de aceitar o último como «não
suportado» em vez de rebentar.

Resultado esperado: 5 conversas, 10 rascunhos, uma única em nível `AUTO`
(a pergunta sobre entregas — intenção informativa, confiança alta e
resposta ancorada no contexto registado).

## Testar o envio e a falha

O duplo da Meta aceita tudo **excepto** o número `258840000000`, que recusa
com o erro 131030. É a forma de ver o tratamento de falhas: a mensagem fica
`FAILED`, o rascunho também, e nasce uma notificação `SEND_FAILED`. Nada
desaparece.

## Repor os dados

```bash
node --import tsx -e "
import {getPool,closePool} from './backend/src/database/pool.js';
const p=getPool();
await p.query('TRUNCATE notifications, ai_drafts, message_analysis, messages, conversations, contacts, webhook_events RESTART IDENTITY CASCADE');
await closePool();"
```

`audit_logs` fica de fora porque é imutável por gatilho — e deve mesmo ser.
