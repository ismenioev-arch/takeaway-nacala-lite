# FASE 6 — Webhook do WhatsApp Business Cloud API

## Visão Geral

O sistema recebe mensagens do WhatsApp através do webhook da Meta. Cada mensagem é validada com HMAC SHA-256, processada de forma idempotente, e armazenada na base de dados com contexto completo (contacto, conversa, análise).

## Fluxo de Dados

```
Meta WhatsApp API
      ↓
POST /api/webhooks/whatsapp
      ↓
Validação HMAC (middleware)
      ↓
Validação Zod (schema)
      ↓
Idempotência (webhook_events)
      ↓
Extrair contacto + mensagem
      ↓
Create/Find contacto
      ↓
Create/Find conversa
      ↓
Store mensagem
      ↓
Incrementar unread_count
      ↓
RESPONSE 200 (async processing)
```

## Configuração na Meta

### 1. Criar WhatsApp Business Account

1. Aceder a [Facebook Business Manager](https://business.facebook.com)
2. Navegar para **Apps & Assets > Apps**
3. Criar nova app (ou usar existente)
4. Adicionar produto: **WhatsApp**

### 2. Configurar Webhook

#### URL do Webhook
```
https://seu-dominio.com/api/webhooks/whatsapp
```

**Nota:** Deve ser HTTPS com certificado válido. A Meta não aceita HTTP.

#### Verify Token
Criar uma string aleatória forte (min 32 caracteres):
```bash
openssl rand -base64 32
```

Guardar em `.env` como:
```env
WHATSAPP_VERIFY_TOKEN=seu_token_aleatorio_aqui
```

#### App Secret
Disponível em **Settings > Basic**. Guardar em `.env`:
```env
WHATSAPP_APP_SECRET=seu_app_secret_aqui
```

### 3. Configurar Subscriptions

No dashboard da Meta:
1. **Webhooks > Configurar Webhooks**
2. URL: `https://seu-dominio.com/api/webhooks/whatsapp`
3. Verify Token: Cole o token que criou
4. **Test & Save**

A Meta fará um GET com parametros:
```
GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=CHALLENGE_TOKEN&hub.verify_token=VERIFY_TOKEN
```

O backend responde com o `hub.challenge`.

### 4. Subscrever a Eventos

Selecionar eventos a receber:
- ✅ **messages** (obrigatório)
- ✅ **message_template_status_update** (para drafts)
- ✅ **message_template_quality_update** (para análise)
- ✅ **delivery** (para status de entrega)

## Variáveis de Ambiente

Adicionar ao `.env`:

```env
# WhatsApp Webhook Security
WHATSAPP_VERIFY_TOKEN=seu_token_aleatorio_aqui
WHATSAPP_APP_SECRET=seu_app_secret_aqui

# Business Phone (obtido na Meta)
WHATSAPP_BUSINESS_PHONE=1234567890

# Phone Number ID (obtido na Meta)
WHATSAPP_PHONE_NUMBER_ID=123456789123456789
```

## Estrutura do Payload

### Handshake (GET)

```http
GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=123ABC&hub.verify_token=VERIFY_TOKEN HTTP/1.1
```

Response:
```
200 OK
123ABC
```

### Evento de Mensagem (POST)

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "123456789",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "551198765432",
              "phone_number_id": "123456789123456789",
              "webhook_id": "987654321"
            },
            "contacts": [
              {
                "profile": {
                  "name": "João Silva"
                },
                "wa_id": "5511987654321"
              }
            ],
            "messages": [
              {
                "from": "5511987654321",
                "id": "wamid.ABC123DEF456",
                "timestamp": "1692975600",
                "type": "text",
                "text": {
                  "body": "Olá! Como vai?"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ],
  "timestamp": "1692975600"
}
```

## Validação HMAC

A Meta assina cada webhook com `X-Hub-Signature-256`:

```
X-Hub-Signature-256: sha256=abcdef123456...
```

O backend valida:
1. Extrai o raw body (antes de JSON parsing)
2. Computa: `HMAC-SHA256(body, WHATSAPP_APP_SECRET)`
3. Compara com timing-safe comparison (protege contra timing attacks)

## Idempotência

Cada mensagem é registada em `webhook_events`:

```
provider: 'WHATSAPP'
external_id: message.id (ex: wamid.ABC123)
status: 'SUCCESS' | 'FAILED'
raw_payload: {...}
error_message: null | error text
```

Se a mesma mensagem chegar 2x:
1. Primeira vez: processada, registada como SUCCESS
2. Segunda vez: detectada como duplicada, ignorada

## Teste Manual

### Com cURL

```bash
# Teste de handshake
curl -X GET "http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=TEST_CHALLENGE&hub.verify_token=VERIFY_TOKEN"

# Resposta esperada:
# TEST_CHALLENGE
```

### Com Payload Válido

```bash
# Gerar HMAC válido
BODY='{"object":"whatsapp_business_account","entry":[...]}'
SECRET='seu_app_secret'
HMAC=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | cut -d' ' -f2)

curl -X POST "http://localhost:3000/api/webhooks/whatsapp" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$HMAC" \
  -d "$BODY"

# Resposta esperada:
# 200 OK
# {"ok": true}
```

## Monitorar Processamento

### Logs

```bash
# Ver logs em produção
npm run logs

# Filtrar por webhook
npm run logs | grep webhook
```

### Tabela webhook_events

```sql
SELECT * FROM webhook_events 
WHERE provider = 'WHATSAPP' 
ORDER BY created_at DESC 
LIMIT 20;
```

### Tabela messages

```sql
SELECT m.id, m.wa_message_id, m.body, m.status, m.created_at
FROM messages m
WHERE m.direction = 'INBOUND'
ORDER BY m.wa_timestamp DESC
LIMIT 20;
```

## Troubleshooting

### "Webhook signature inválida"

**Causa:** HMAC não confere  
**Solução:**
- Verificar `WHATSAPP_APP_SECRET` está correto
- Verificar que está usando raw body (não JSON parsed)
- Verificar que a Meta está usando o secret correto

### "Verify token inválido"

**Causa:** Token do handshake não confere  
**Solução:**
- Verificar `WHATSAPP_VERIFY_TOKEN` está correto
- Configurar o mesmo token na Meta

### Mensagem não aparece

**Causas possíveis:**
- Webhook não está registado na Meta
- URL não é HTTPS
- Certificado SSL inválido
- IP da Meta não está whitelistado (se aplicável)

**Verificar:**
```bash
# Testar HTTPS
curl -vI https://seu-dominio.com/api/webhooks/whatsapp

# Ver status na Meta Dashboard
# Settings > Webhooks > Status
```

### "Raw body não disponível"

**Causa:** Middleware `registerRawBodyParser` não foi chamado  
**Solução:** Verificar que em `app.ts`, o middleware é registado ANTES de qualquer rota:

```typescript
// Deve vir PRIMEIRO
registerRawBodyParser(app);

// Depois middleware de validação
registerWhatsAppWebhookValidation(app);

// Depois as rotas
registerWebhookRoutes(app);
```

## Deploy em Produção

### Checklist

- [ ] `WHATSAPP_VERIFY_TOKEN` definido no `.env` de produção
- [ ] `WHATSAPP_APP_SECRET` definido no `.env` de produção
- [ ] URL webhook registada na Meta (HTTPS válido)
- [ ] Certificado SSL renovado (usar Let's Encrypt)
- [ ] Testes de carga executados (simulador de webhook)
- [ ] Monitoring ativo (logs, alertas em erros)
- [ ] Backup automático da base de dados

### Monitoring

Verificar regularmente:
```sql
-- Taxa de sucesso
SELECT 
  COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) as success,
  COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed,
  ROUND(100.0 * COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) / COUNT(*), 2) as success_rate
FROM webhook_events
WHERE provider = 'WHATSAPP'
AND created_at > NOW() - INTERVAL '24 hours';

-- Mensagens recentes
SELECT COUNT(*) as total_inbound
FROM messages
WHERE direction = 'INBOUND'
AND created_at > NOW() - INTERVAL '24 hours';
```

## Próximas Fases

- **FASE 7:** Análise de IA (intent, priority, urgency)
- **FASE 8:** Geração de rascunhos automáticos
- **FASE 9:** Integração com sistema de envio (outbound)
