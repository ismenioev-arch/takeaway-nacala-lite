-- =============================================================================
-- WIM — Migração 002: o domínio central
-- =============================================================================
-- FASE 2. Cria contactos, conversas, mensagens, análises da IA, rascunhos,
-- etiquetas, notificações, acompanhamentos, auditoria, contexto da empresa e
-- o registo de eventos do webhook.
--
-- Todos os tipos enumerados vêm da migração 001. Esta migração não cria tipos.
--
-- Duas regras da especificação estão escritas em constraints, e não apenas em
-- código, porque são as que não podem falhar nunca:
--
--   1. Secção 16 — a mesma mensagem não pode ser processada duas vezes.
--      → messages.wa_message_id é UNIQUE.
--
--   2. Secção 3  — a IA analisa e recomenda; o humano aprova e só depois se
--      executa.
--      → ai_drafts recusa APPROVED sem um utilizador identificado, e recusa
--        SENT de um rascunho não automático sem esse utilizador.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- contacts — quem nos escreve (secção 13)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE contacts (
  id                  uuid             PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificador do contacto na WhatsApp Cloud API. É a chave natural que
  -- liga o nosso registo ao do WhatsApp.
  wa_id               text             NOT NULL UNIQUE,
  phone_e164          text             NOT NULL,

  -- Nome que o WhatsApp devolve no perfil (não controlamos, pode mudar).
  profile_name        text,
  -- Nome definido por nós. Tem prioridade sobre o do perfil.
  display_name        text,

  company             text,
  location            text,
  notes               text,
  category            contact_category NOT NULL DEFAULT 'PROSPECT',

  first_contact_at    timestamptz      NOT NULL DEFAULT now(),
  last_contact_at     timestamptz      NOT NULL DEFAULT now(),
  conversation_count  integer          NOT NULL DEFAULT 0,

  created_at          timestamptz      NOT NULL DEFAULT now(),
  updated_at          timestamptz      NOT NULL DEFAULT now(),

  -- Formato E.164: '+' seguido de 8 a 15 dígitos, o primeiro diferente de zero.
  CONSTRAINT contacts_phone_e164_format CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT contacts_wa_id_not_blank   CHECK (btrim(wa_id) <> ''),
  CONSTRAINT contacts_counts_not_negative CHECK (conversation_count >= 0),
  CONSTRAINT contacts_contact_dates_ordered CHECK (last_contact_at >= first_contact_at)
);

-- Coluna calculada para a pesquisa global (secção 30). Fica sempre coerente
-- com as outras colunas porque é o PostgreSQL que a mantém.
ALTER TABLE contacts
  ADD COLUMN search_text text
  GENERATED ALWAYS AS (
    coalesce(display_name, '') || ' ' ||
    coalesce(profile_name, '') || ' ' ||
    coalesce(company, '')      || ' ' ||
    phone_e164
  ) STORED;

CREATE INDEX contacts_phone_idx        ON contacts (phone_e164);
CREATE INDEX contacts_category_idx     ON contacts (category);
CREATE INDEX contacts_last_contact_idx ON contacts (last_contact_at DESC);
CREATE INDEX contacts_search_idx       ON contacts USING gin (search_text gin_trgm_ops);

CREATE TRIGGER contacts_set_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN contacts.wa_id IS
  'Identificador do contacto na WhatsApp Cloud API.';
COMMENT ON COLUMN contacts.display_name IS
  'Nome definido no painel. Tem prioridade sobre profile_name ao mostrar.';


-- ─────────────────────────────────────────────────────────────────────────────
-- conversations — o fio de conversa com um contacto (secção 22)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE conversations (
  id                uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        uuid                NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,

  status            conversation_status NOT NULL DEFAULT 'NEW',
  priority          message_priority    NOT NULL DEFAULT 'NORMAL',
  subject           text,

  last_message_at   timestamptz,
  last_inbound_at   timestamptz,
  last_outbound_at  timestamptz,
  unread_count      integer             NOT NULL DEFAULT 0,

  resolved_at       timestamptz,
  resolved_by       uuid                REFERENCES users (id) ON DELETE SET NULL,

  created_at        timestamptz         NOT NULL DEFAULT now(),
  updated_at        timestamptz         NOT NULL DEFAULT now(),

  CONSTRAINT conversations_unread_not_negative CHECK (unread_count >= 0),
  -- Uma conversa marcada como resolvida tem de dizer quando o foi.
  CONSTRAINT conversations_resolved_has_timestamp
    CHECK (status <> 'RESOLVED' OR resolved_at IS NOT NULL)
);

-- Regra do domínio: no máximo UMA conversa aberta por contacto. Quando a
-- anterior é resolvida ou arquivada, uma mensagem nova abre outra.
-- O índice parcial impõe isto — não depende de o código se lembrar.
CREATE UNIQUE INDEX conversations_one_open_per_contact_idx
  ON conversations (contact_id)
  WHERE status NOT IN ('RESOLVED', 'ARCHIVED');

-- Consulta principal do painel: as urgências primeiro, as mais recentes no topo.
CREATE INDEX conversations_triage_idx
  ON conversations (priority, last_message_at DESC)
  WHERE status NOT IN ('RESOLVED', 'ARCHIVED');

CREATE INDEX conversations_contact_idx      ON conversations (contact_id);
CREATE INDEX conversations_status_idx       ON conversations (status);
CREATE INDEX conversations_last_message_idx ON conversations (last_message_at DESC NULLS LAST);

CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON INDEX conversations_one_open_per_contact_idx IS
  'Garante no máximo uma conversa aberta por contacto.';


-- ─────────────────────────────────────────────────────────────────────────────
-- messages — cada mensagem recebida ou enviada (secções 16 e 23)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id               uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid              NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  -- Desnormalizado de propósito: permite pesquisar mensagens por contacto
  -- sem juntar conversations em todas as consultas.
  contact_id       uuid              NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,

  direction        message_direction NOT NULL,

  -- ⬅ A CHAVE DA IDEMPOTÊNCIA (secção 16).
  -- Identificador atribuído pelo WhatsApp. UNIQUE, e por isso a inserção
  -- com ON CONFLICT DO NOTHING torna impossível processar duas vezes,
  -- mesmo com vários processos em paralelo.
  -- Fica NULL apenas em mensagens de saída ainda não entregues à Meta;
  -- o PostgreSQL permite vários NULL num índice único.
  wa_message_id    text              UNIQUE,

  type             message_type      NOT NULL DEFAULT 'text',
  body             text,
  caption          text,

  media_id         text,
  media_mime       text,
  media_sha256     text,

  status           message_status    NOT NULL DEFAULT 'RECEIVED',
  sent_by_user_id  uuid              REFERENCES users (id) ON DELETE SET NULL,

  -- Hora dada pelo WhatsApp, que pode diferir da hora a que recebemos.
  wa_timestamp     timestamptz       NOT NULL DEFAULT now(),

  error_code       text,
  error_detail     text,
  -- Payload original, para diagnóstico quando algo corre mal.
  raw              jsonb,

  created_at       timestamptz       NOT NULL DEFAULT now(),
  updated_at       timestamptz       NOT NULL DEFAULT now(),

  -- Toda a mensagem recebida traz identificador do WhatsApp. Sem ele não há
  -- como garantir idempotência, por isso recusamos guardá-la.
  CONSTRAINT messages_inbound_requires_wa_id
    CHECK (direction <> 'INBOUND' OR wa_message_id IS NOT NULL),

  -- Uma mensagem de texto sem texto é um erro de programação, não um dado.
  CONSTRAINT messages_text_requires_body
    CHECK (type <> 'text' OR btrim(coalesce(body, '')) <> ''),

  -- Mensagens com media têm de identificar essa media.
  CONSTRAINT messages_media_requires_media_id
    CHECK (type NOT IN ('image', 'document', 'audio', 'video', 'sticker')
           OR media_id IS NOT NULL),

  CONSTRAINT messages_failed_requires_reason
    CHECK (status <> 'FAILED' OR error_code IS NOT NULL OR error_detail IS NOT NULL)
);

CREATE INDEX messages_conversation_idx ON messages (conversation_id, wa_timestamp DESC);
CREATE INDEX messages_contact_idx      ON messages (contact_id, wa_timestamp DESC);
CREATE INDEX messages_status_idx       ON messages (status);
CREATE INDEX messages_body_search_idx  ON messages USING gin (body gin_trgm_ops);

-- Fila de análise: quais as mensagens recebidas ainda por analisar.
CREATE INDEX messages_pending_analysis_idx
  ON messages (created_at)
  WHERE direction = 'INBOUND' AND status IN ('RECEIVED', 'ANALYZING');

CREATE TRIGGER messages_set_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN messages.wa_message_id IS
  'Identificador do WhatsApp. UNIQUE — é o que impede processar a mesma mensagem duas vezes (secção 16).';


-- ─────────────────────────────────────────────────────────────────────────────
-- message_analysis — o que a IA concluiu (secções 4, 5 e 6)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE message_analysis (
  id                  uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Uma análise por mensagem. Reanalisar substitui, não acumula.
  message_id          uuid             NOT NULL UNIQUE REFERENCES messages (id) ON DELETE CASCADE,

  priority            message_priority NOT NULL,
  intent              message_intent   NOT NULL,
  confidence          numeric(4,3)     NOT NULL,
  summary             text             NOT NULL,
  urgency_reason      text,
  requires_human      boolean          NOT NULL,
  recommended_action  text,

  -- Que modelo e que versão do prompt produziram este resultado. Sem isto é
  -- impossível saber, meses depois, porque é que a classificação mudou.
  model               text             NOT NULL,
  prompt_version      text             NOT NULL,

  -- Controlo de custo (risco 6 do documento de arquitectura).
  tokens_input        integer,
  tokens_output       integer,
  latency_ms          integer,

  raw_response        jsonb,
  created_at          timestamptz      NOT NULL DEFAULT now(),

  CONSTRAINT message_analysis_confidence_range CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT message_analysis_summary_not_blank CHECK (btrim(summary) <> ''),
  CONSTRAINT message_analysis_tokens_not_negative
    CHECK (coalesce(tokens_input, 0) >= 0 AND coalesce(tokens_output, 0) >= 0),
  CONSTRAINT message_analysis_latency_not_negative CHECK (coalesce(latency_ms, 0) >= 0),

  -- Se a IA diz que é urgente, tem de dizer porquê. É o que o painel mostra
  -- ao utilizador para ele decidir em segundos (secção 10).
  CONSTRAINT message_analysis_urgent_requires_reason
    CHECK (priority <> 'URGENTE' OR btrim(coalesce(urgency_reason, '')) <> '')
);

CREATE INDEX message_analysis_priority_idx ON message_analysis (priority);
CREATE INDEX message_analysis_intent_idx   ON message_analysis (intent);


-- ─────────────────────────────────────────────────────────────────────────────
-- ai_drafts — a resposta sugerida (secções 3, 6 e 8)
--
-- ESTA TABELA É O CORAÇÃO DA REGRA DE SEGURANÇA DO SISTEMA.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE ai_drafts (
  id                   uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id           uuid             NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  conversation_id      uuid             NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,

  automation_level     automation_level NOT NULL,

  -- O que a IA escreveu. Nunca é alterado: se o humano editar, a edição vai
  -- para edited_content. Assim fica sempre visível o que a IA propôs.
  content              text             NOT NULL,
  edited_content       text,

  status               draft_status     NOT NULL DEFAULT 'DRAFT',

  -- RESTRICT, e não SET NULL, de propósito.
  --
  -- Se apagar o utilizador pusesse esta coluna a NULL, um rascunho aprovado
  -- ficaria "aprovado por ninguém" — e as constraints abaixo, que são a
  -- espinha dorsal da secção 3, passariam a impedir apagar o utilizador com
  -- um erro incompreensível.
  --
  -- A cadeia de responsabilidade não se apaga: um utilizador que já aprovou
  -- respostas desactiva-se (is_active = false), não se remove.
  approved_by_user_id  uuid             REFERENCES users (id) ON DELETE RESTRICT,
  approved_at          timestamptz,
  sent_message_id      uuid             REFERENCES messages (id) ON DELETE SET NULL,

  error_code           text,
  error_detail         text,

  created_at           timestamptz      NOT NULL DEFAULT now(),
  updated_at           timestamptz      NOT NULL DEFAULT now(),

  CONSTRAINT ai_drafts_content_not_blank CHECK (btrim(content) <> ''),

  -- ═══ REGRA 1 ═══════════════════════════════════════════════════════════
  -- "Aprovado" significa "um humano aprovou". Sem utilizador identificado e
  -- sem data, não é aprovação. A base de dados recusa, mesmo que houvesse um
  -- erro no código da aplicação.
  CONSTRAINT ai_drafts_approved_requires_human
    CHECK (status <> 'APPROVED'
           OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)),

  -- ═══ REGRA 2 ═══════════════════════════════════════════════════════════
  -- Só um rascunho de nível AUTO pode ser enviado sem aprovação humana.
  -- Orçamentos, pagamentos, reclamações e tudo o que for classificado como
  -- DRAFT ou HUMAN_REQUIRED exige sempre uma pessoa (secção 8, nível 3).
  CONSTRAINT ai_drafts_send_requires_human_unless_auto
    CHECK (status <> 'SENT'
           OR automation_level = 'AUTO'
           OR approved_by_user_id IS NOT NULL),

  -- Um rascunho enviado tem de apontar para a mensagem que saiu.
  CONSTRAINT ai_drafts_sent_requires_message
    CHECK (status <> 'SENT' OR sent_message_id IS NOT NULL),

  -- "Editado" sem edição não faz sentido.
  CONSTRAINT ai_drafts_edited_requires_edit
    CHECK (status <> 'EDITED' OR btrim(coalesce(edited_content, '')) <> ''),

  CONSTRAINT ai_drafts_failed_requires_reason
    CHECK (status <> 'FAILED' OR error_code IS NOT NULL OR error_detail IS NOT NULL),

  -- Data de aprovação e utilizador andam sempre juntos.
  CONSTRAINT ai_drafts_approval_fields_together
    CHECK ((approved_by_user_id IS NULL) = (approved_at IS NULL))
);

-- No máximo um rascunho por decidir para cada mensagem: evita mostrar ao
-- utilizador duas sugestões concorrentes para a mesma coisa.
CREATE UNIQUE INDEX ai_drafts_one_pending_per_message_idx
  ON ai_drafts (message_id)
  WHERE status IN ('DRAFT', 'EDITED', 'APPROVED');

CREATE INDEX ai_drafts_conversation_idx ON ai_drafts (conversation_id);
CREATE INDEX ai_drafts_pending_idx
  ON ai_drafts (created_at DESC)
  WHERE status IN ('DRAFT', 'EDITED');

CREATE TRIGGER ai_drafts_set_updated_at
  BEFORE UPDATE ON ai_drafts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON CONSTRAINT ai_drafts_approved_requires_human ON ai_drafts IS
  'Secção 3: a IA recomenda, o humano aprova. Sem utilizador não há aprovação.';
COMMENT ON CONSTRAINT ai_drafts_send_requires_human_unless_auto ON ai_drafts IS
  'Secção 8: só o nível AUTO pode ser enviado sem uma pessoa aprovar.';


-- ─────────────────────────────────────────────────────────────────────────────
-- tags / conversation_tags (secção 14)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE tags (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       citext      NOT NULL UNIQUE,
  color      text        NOT NULL DEFAULT '#64748b',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tags_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT tags_color_format   CHECK (color ~ '^#[0-9a-fA-F]{6}$')
);

CREATE TRIGGER tags_set_updated_at
  BEFORE UPDATE ON tags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE conversation_tags (
  conversation_id uuid        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  tag_id          uuid        NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (conversation_id, tag_id)
);

CREATE INDEX conversation_tags_tag_idx ON conversation_tags (tag_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- notifications (secção 21)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id               uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  type             notification_type NOT NULL,
  priority         message_priority  NOT NULL DEFAULT 'NORMAL',

  title            text              NOT NULL,
  body             text,

  conversation_id  uuid              REFERENCES conversations (id) ON DELETE CASCADE,
  message_id       uuid              REFERENCES messages (id) ON DELETE CASCADE,
  contact_id       uuid              REFERENCES contacts (id) ON DELETE CASCADE,

  is_read          boolean           NOT NULL DEFAULT false,
  read_at          timestamptz,
  read_by          uuid              REFERENCES users (id) ON DELETE SET NULL,

  created_at       timestamptz       NOT NULL DEFAULT now(),

  CONSTRAINT notifications_title_not_blank CHECK (btrim(title) <> ''),
  -- Marcada como lida sem data de leitura seria um registo incoerente.
  CONSTRAINT notifications_read_has_timestamp
    CHECK (is_read = false OR read_at IS NOT NULL)
);

-- O sino do painel: as por ler, mais recentes primeiro.
CREATE INDEX notifications_unread_idx
  ON notifications (created_at DESC)
  WHERE is_read = false;

CREATE INDEX notifications_conversation_idx ON notifications (conversation_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- follow_ups (secção 31)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE follow_ups (
  id               uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid             NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  contact_id       uuid             NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,

  due_at           timestamptz      NOT NULL,
  note             text,
  status           follow_up_status NOT NULL DEFAULT 'PENDING',

  created_by       uuid             REFERENCES users (id) ON DELETE SET NULL,
  completed_at     timestamptz,

  created_at       timestamptz      NOT NULL DEFAULT now(),
  updated_at       timestamptz      NOT NULL DEFAULT now(),

  CONSTRAINT follow_ups_done_has_timestamp
    CHECK (status <> 'DONE' OR completed_at IS NOT NULL)
);

-- "Que lembretes vencem hoje?" — a consulta que o sistema faz periodicamente.
CREATE INDEX follow_ups_due_idx
  ON follow_ups (due_at)
  WHERE status = 'PENDING';

CREATE INDEX follow_ups_conversation_idx ON follow_ups (conversation_id);

CREATE TRIGGER follow_ups_set_updated_at
  BEFORE UPDATE ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- audit_logs (secção 24) — só INSERT. Nunca UPDATE, nunca DELETE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL significa "acção do sistema" (por exemplo, uma resposta automática).
  -- RESTRICT pela mesma razão de ai_drafts: um registo de auditoria que perde
  -- o autor deixa de ser auditoria. Utilizadores desactivam-se, não se apagam.
  user_id      uuid        REFERENCES users (id) ON DELETE RESTRICT,

  action       text        NOT NULL,
  entity_type  text        NOT NULL,
  entity_id    uuid,

  old_value    jsonb,
  new_value    jsonb,

  ip_address   inet,
  user_agent   text,

  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_logs_action_not_blank      CHECK (btrim(action) <> ''),
  CONSTRAINT audit_logs_entity_type_not_blank CHECK (btrim(entity_type) <> '')
);

CREATE INDEX audit_logs_entity_idx  ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_user_idx    ON audit_logs (user_id, created_at DESC);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- Um registo de auditoria que pode ser alterado não é um registo de auditoria.
CREATE OR REPLACE FUNCTION audit_logs_forbid_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs é imutável: % não é permitido (secção 24 da especificação)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_forbid_change();

COMMENT ON TABLE audit_logs IS
  'Registo imutável de acções. Um gatilho recusa UPDATE e DELETE.';


-- ─────────────────────────────────────────────────────────────────────────────
-- Contexto da empresa (secção 20)
--
-- A IA só pode usar informação daqui. Em particular, só vê os preços com
-- is_authorized_for_ai = true.
-- ─────────────────────────────────────────────────────────────────────────────

-- Uma única linha. O id fixo em 1 impede criar um segundo perfil por engano.
CREATE TABLE company_profile (
  id                 smallint    PRIMARY KEY DEFAULT 1,

  name               text        NOT NULL,
  description        text,
  location           text,
  business_hours     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  contact_phone      text,
  contact_email      citext,
  policies           text,
  service_rules      text,

  -- Interruptor geral do nível 1 (resposta automática). Desligado por omissão.
  auto_reply_enabled boolean     NOT NULL DEFAULT false,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT company_profile_singleton  CHECK (id = 1),
  CONSTRAINT company_profile_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TRIGGER company_profile_set_updated_at
  BEFORE UPDATE ON company_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON CONSTRAINT company_profile_singleton ON company_profile IS
  'Só existe uma empresa. O id fixo impede criar um segundo perfil.';


CREATE TABLE company_services (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  description   text,
  is_active     boolean     NOT NULL DEFAULT true,
  display_order integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT company_services_name_not_blank CHECK (btrim(name) <> ''),
  -- Dois serviços com o mesmo nome são um erro de introdução de dados,
  -- não dois serviços.
  CONSTRAINT company_services_name_unique UNIQUE (name)
);

CREATE INDEX company_services_active_idx ON company_services (display_order) WHERE is_active;

CREATE TRIGGER company_services_set_updated_at
  BEFORE UPDATE ON company_services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE company_prices (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id            uuid          REFERENCES company_services (id) ON DELETE CASCADE,

  label                 text          NOT NULL,
  amount                numeric(14,2) NOT NULL,
  currency              char(3)       NOT NULL DEFAULT 'MZN',
  notes                 text,

  -- ⬅ A IA só vê as linhas com true. Tudo o resto lhe é invisível.
  -- Falso por omissão: um preço novo nunca fica exposto por esquecimento.
  is_authorized_for_ai  boolean       NOT NULL DEFAULT false,

  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT company_prices_label_not_blank CHECK (btrim(label) <> ''),
  CONSTRAINT company_prices_amount_not_negative CHECK (amount >= 0),
  CONSTRAINT company_prices_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

-- Um serviço não pode ter duas linhas com a mesma etiqueta: seria impossível
-- saber qual delas a IA está autorizada a comunicar.
-- O COALESCE trata o service_id NULL como um valor concreto, porque num índice
-- único dois NULL são considerados diferentes entre si.
CREATE UNIQUE INDEX company_prices_service_label_idx
  ON company_prices (coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid), label);

CREATE INDEX company_prices_authorized_idx
  ON company_prices (service_id)
  WHERE is_authorized_for_ai;

CREATE TRIGGER company_prices_set_updated_at
  BEFORE UPDATE ON company_prices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN company_prices.is_authorized_for_ai IS
  'Só os preços com true são enviados à IA. Falso por omissão, de propósito (secção 7).';


CREATE TABLE company_faqs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  question      text        NOT NULL,
  answer        text        NOT NULL,
  keywords      text[]      NOT NULL DEFAULT '{}',
  is_active     boolean     NOT NULL DEFAULT true,
  display_order integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT company_faqs_question_not_blank CHECK (btrim(question) <> ''),
  CONSTRAINT company_faqs_answer_not_blank   CHECK (btrim(answer) <> ''),
  -- A mesma pergunta duas vezes daria à IA duas respostas concorrentes.
  CONSTRAINT company_faqs_question_unique    UNIQUE (question)
);

CREATE INDEX company_faqs_active_idx   ON company_faqs (display_order) WHERE is_active;
CREATE INDEX company_faqs_keywords_idx ON company_faqs USING gin (keywords);

CREATE TRIGGER company_faqs_set_updated_at
  BEFORE UPDATE ON company_faqs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- webhook_events (secção 16) — segunda camada de idempotência
--
-- A Meta reenvia o evento se não receber 200 depressa. Guardamos o evento
-- bruto assim que chega: o UNIQUE apanha o reenvio antes de qualquer
-- processamento, e o payload fica disponível para diagnóstico.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE webhook_events (
  id               uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         text                 NOT NULL DEFAULT 'whatsapp',
  -- Identificador do evento no fornecedor, ou o hash do payload quando o
  -- fornecedor não dá um identificador próprio.
  external_id      text                 NOT NULL,

  payload          jsonb                NOT NULL,
  signature_valid  boolean              NOT NULL,

  status           webhook_event_status NOT NULL DEFAULT 'PENDING',
  error            text,

  received_at      timestamptz          NOT NULL DEFAULT now(),
  processed_at     timestamptz,

  CONSTRAINT webhook_events_provider_not_blank    CHECK (btrim(provider) <> ''),
  CONSTRAINT webhook_events_external_id_not_blank CHECK (btrim(external_id) <> ''),
  CONSTRAINT webhook_events_processed_has_timestamp
    CHECK (status <> 'PROCESSED' OR processed_at IS NOT NULL),
  CONSTRAINT webhook_events_failed_requires_error
    CHECK (status <> 'FAILED' OR error IS NOT NULL),

  CONSTRAINT webhook_events_unique_per_provider UNIQUE (provider, external_id)
);

CREATE INDEX webhook_events_pending_idx
  ON webhook_events (received_at)
  WHERE status = 'PENDING';

-- Tentativas com assinatura inválida são sinal de abuso: têm de ser fáceis de ver.
CREATE INDEX webhook_events_invalid_signature_idx
  ON webhook_events (received_at DESC)
  WHERE NOT signature_valid;

COMMENT ON TABLE webhook_events IS
  'Registo bruto dos eventos recebidos. UNIQUE(provider, external_id) apanha reenvios da Meta.';
