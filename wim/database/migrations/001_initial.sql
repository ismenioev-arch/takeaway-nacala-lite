-- =============================================================================
-- WIM — Migração 001: extensões, tipos do domínio, utilizadores e definições
-- =============================================================================
-- FASE 1. Cria apenas as fundações. As tabelas de contactos, conversas,
-- mensagens, análises e rascunhos chegam na FASE 2 (migração 002).
--
-- Os tipos enumerados são todos criados aqui, de uma vez, porque são o
-- vocabulário partilhado do sistema (secções 4, 5, 13, 22 e 23 da
-- especificação) e as migrações seguintes limitam-se a usá-los.
-- =============================================================================

-- ── Extensões ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS citext;   -- e-mail sem distinção de maiúsculas
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- pesquisa global por semelhança (secção 30)


-- ── Tipos do domínio ─────────────────────────────────────────────────────────

-- Secção 25 — papéis e permissões
CREATE TYPE user_role AS ENUM ('OWNER', 'ADMIN', 'AGENT');

-- Secção 13 — categorias de contacto
CREATE TYPE contact_category AS ENUM (
  'CLIENTE', 'PROSPECT', 'FORNECEDOR', 'PARCEIRO', 'EQUIPA', 'OUTRO'
);

-- Secção 22 — estados da conversa
CREATE TYPE conversation_status AS ENUM (
  'NEW', 'OPEN', 'WAITING_HUMAN', 'WAITING_CUSTOMER', 'FOLLOW_UP', 'RESOLVED', 'ARCHIVED'
);

-- Secção 4 — prioridade. A ordem da declaração é a ordem de gravidade:
-- URGENTE < IMPORTANTE < ACOMPANHAR < NORMAL na ordenação natural do enum,
-- o que permite `ORDER BY priority` sem CASE e sem tabela auxiliar.
CREATE TYPE message_priority AS ENUM ('URGENTE', 'IMPORTANTE', 'ACOMPANHAR', 'NORMAL');

-- Secção 5 — intenção
CREATE TYPE message_intent AS ENUM (
  'NOVO_CLIENTE', 'ORCAMENTO', 'PROJETO', 'ALTERACAO_PROJETO', 'OBRA',
  'PAGAMENTO', 'COBRANCA', 'RECLAMACAO', 'REUNIAO', 'DOCUMENTO',
  'PRAZO', 'SUPORTE', 'INFORMACAO', 'NEGOCIACAO', 'OUTRO'
);

CREATE TYPE message_direction AS ENUM ('INBOUND', 'OUTBOUND');

CREATE TYPE message_type AS ENUM (
  'text', 'image', 'document', 'audio', 'video', 'sticker',
  'location', 'contacts', 'interactive', 'button', 'system', 'unsupported'
);

-- Secção 23 — estados da mensagem
CREATE TYPE message_status AS ENUM (
  'RECEIVED', 'ANALYZING', 'ANALYZED', 'DRAFTED',
  'APPROVED', 'SENT', 'DELIVERED', 'READ', 'FAILED'
);

-- Secção 8 — níveis de automação
CREATE TYPE automation_level AS ENUM ('AUTO', 'DRAFT', 'HUMAN_REQUIRED');

CREATE TYPE draft_status AS ENUM (
  'DRAFT', 'EDITED', 'APPROVED', 'SENT', 'CANCELLED', 'FAILED'
);

-- Secção 21 — notificações
CREATE TYPE notification_type AS ENUM (
  'URGENT_MESSAGE', 'APPROVAL_PENDING', 'FOLLOW_UP_DUE', 'SEND_FAILED'
);

-- Secção 31 — follow-up
CREATE TYPE follow_up_status AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- Secção 16 — idempotência do webhook
CREATE TYPE webhook_event_status AS ENUM ('PENDING', 'PROCESSED', 'DUPLICATE', 'FAILED');


-- ── `updated_at` automático ──────────────────────────────────────────────────
-- Manter isto no gatilho, e não no código, garante que a coluna está correcta
-- mesmo quando alguém altera a linha por SQL directo.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


-- ── users ────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext      NOT NULL UNIQUE,
  -- Nunca a password. Sempre um hash argon2id (secção 25).
  password_hash  text        NOT NULL,
  name           text        NOT NULL,
  role           user_role   NOT NULL DEFAULT 'AGENT',
  is_active      boolean     NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT users_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT users_password_hash_not_blank CHECK (btrim(password_hash) <> '')
);

CREATE INDEX users_role_idx ON users (role) WHERE is_active;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE users IS 'Utilizadores do painel WIM. Não são contactos do WhatsApp.';
COMMENT ON COLUMN users.password_hash IS 'Hash argon2id. Nunca guardar a password em claro.';


-- ── settings ─────────────────────────────────────────────────────────────────
-- Configuração da aplicação. NUNCA segredos: chaves de API, tokens e passwords
-- vivem em variáveis de ambiente (secções 14 e 25).
CREATE TABLE settings (
  key         text        PRIMARY KEY,
  value       jsonb       NOT NULL,
  description text,
  updated_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT settings_key_format CHECK (key ~ '^[a-z][a-z0-9_.]*$')
);

CREATE TRIGGER settings_set_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE settings IS
  'Configuração não-secreta. Segredos vivem em variáveis de ambiente, nunca aqui.';

INSERT INTO settings (key, value, description) VALUES
  ('ai.automation_enabled', 'false'::jsonb,
   'Liga o nível 1 (resposta automática). Desligado por omissão: o humano decide primeiro.'),
  ('ai.confidence_threshold', '0.9'::jsonb,
   'Confiança mínima da IA para uma resposta poder ser automática.'),
  ('followup.default_days', '3'::jsonb,
   'Dias por omissão para um lembrete de acompanhamento.'),
  ('dashboard.attention_limit', '20'::jsonb,
   'Quantos itens mostrar na área "Precisa da Minha Atenção".');
