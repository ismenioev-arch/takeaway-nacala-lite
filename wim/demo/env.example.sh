# Ambiente de demonstração. Use:  source wim/demo/env.example.sh
export NODE_ENV=development
export DATABASE_URL='postgresql://wim:wim_dev_password@127.0.0.1:5432/wim'
export JWT_ACCESS_SECRET='segredo-de-acesso-de-demonstracao-com-32-caracteres'
export JWT_REFRESH_SECRET='outro-segredo-de-demonstracao-com-32-caracteres-no-minimo'
export CRON_SECRET='segredo-da-fila-de-analise-para-demonstracao'

# WhatsApp — apontado ao duplo local, nunca à Meta a sério.
export WHATSAPP_ENABLED=true
export WHATSAPP_APP_SECRET='segredo-de-app-da-demonstracao-1234567890'
export WHATSAPP_VERIFY_TOKEN='token-de-verificacao-da-demonstracao'
export WHATSAPP_ACCESS_TOKEN='token-de-acesso-da-demonstracao'
export WHATSAPP_PHONE_NUMBER_ID='106540352242922'
export WHATSAPP_GRAPH_URL='http://127.0.0.1:4100'

# IA — apontada ao duplo local.
export AI_ENABLED=true
export ANTHROPIC_API_KEY='sk-ant-demonstracao'
export ANTHROPIC_BASE_URL='http://127.0.0.1:4100'
