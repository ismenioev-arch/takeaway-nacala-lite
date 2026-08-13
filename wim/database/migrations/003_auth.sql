-- =============================================================================
-- WIM — Migração 003: sessões e tentativas de entrada
-- =============================================================================
-- FASE 4. Autenticação (especificação, secção 25).
--
-- Duas ideias governam este ficheiro:
--
--   1. A base de dados nunca guarda um segredo utilizável. Da password guarda
--      um hash argon2id; do refresh token guarda um hash SHA-256. Quem leia a
--      base de dados não consegue entrar na conta de ninguém.
--
--   2. Um refresh token usado duas vezes é sinal de roubo. Guardamos o
--      encadeamento (`replaced_by`) para detectar essa reutilização e poder
--      revogar todas as sessões do utilizador de uma vez.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- refresh_tokens — as sessões abertas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- SHA-256 do token, nunca o token. Um SHA-256 em hexadecimal tem 64
  -- caracteres; a constraint impede guardar por engano o valor em claro.
  token_hash   text        NOT NULL UNIQUE,

  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  -- Motivo da revogação: 'logout', 'rotated', 'reuse_detected', 'password_changed'.
  revoked_reason text,

  -- Token que substituiu este numa renovação. Permite seguir a cadeia e
  -- perceber que uma sessão antiga foi reutilizada.
  replaced_by  uuid        REFERENCES refresh_tokens (id) ON DELETE SET NULL,

  ip_address   inet,
  user_agent   text,

  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,

  CONSTRAINT refresh_tokens_hash_is_sha256 CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT refresh_tokens_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT refresh_tokens_revoked_has_reason
    CHECK (revoked_at IS NULL OR revoked_reason IS NOT NULL)
);

-- "Que sessões estão abertas deste utilizador?" — usada em cada renovação e
-- ao revogar tudo por suspeita de roubo.
CREATE INDEX refresh_tokens_active_idx
  ON refresh_tokens (user_id)
  WHERE revoked_at IS NULL;

-- Limpeza periódica dos tokens já expirados.
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens (expires_at);

COMMENT ON TABLE refresh_tokens IS
  'Sessões abertas. Guarda o SHA-256 do token, nunca o token.';
COMMENT ON COLUMN refresh_tokens.replaced_by IS
  'Encadeamento das renovações. Reutilizar um token já substituído indica roubo.';


-- ─────────────────────────────────────────────────────────────────────────────
-- login_attempts — travão de força bruta (secção 25)
-- ─────────────────────────────────────────────────────────────────────────────
-- Registamos cada tentativa, com sucesso ou sem ele. Serve para dois fins:
--   • bloquear temporariamente quem tenta adivinhar passwords;
--   • dar ao dono do sistema uma forma de ver tentativas suspeitas.
--
-- O e-mail é guardado como veio, para se poder ver que conta foi visada;
-- a password nunca é registada, nem sequer em caso de falha.
CREATE TABLE login_attempts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        citext      NOT NULL,
  ip_address   inet,
  user_agent   text,
  succeeded    boolean     NOT NULL,
  -- 'invalid_credentials', 'user_inactive', 'rate_limited'
  failure_reason text,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT login_attempts_failure_has_reason
    CHECK (succeeded = true OR failure_reason IS NOT NULL)
);

-- A consulta do travão: quantas falhas houve nos últimos minutos.
CREATE INDEX login_attempts_recent_failures_idx
  ON login_attempts (email, created_at DESC)
  WHERE NOT succeeded;

CREATE INDEX login_attempts_ip_idx
  ON login_attempts (ip_address, created_at DESC)
  WHERE NOT succeeded;

COMMENT ON TABLE login_attempts IS
  'Tentativas de entrada, para travar força bruta. Nunca guarda a password.';


-- ─────────────────────────────────────────────────────────────────────────────
-- users — campos de segurança que faltavam
-- ─────────────────────────────────────────────────────────────────────────────

-- Momento a partir do qual os tokens antigos deixam de valer. Ao mudar a
-- password, basta actualizar esta coluna para invalidar todos os acessos
-- emitidos antes — sem precisar de os apagar um a um.
ALTER TABLE users
  ADD COLUMN tokens_valid_from timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN users.tokens_valid_from IS
  'Tokens emitidos antes desta data são recusados. Actualizado ao mudar a password.';
