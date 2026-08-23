-- =============================================================================
-- AutoEdit — Schema de usuários e domínio multiusuário
-- Alvo: PostgreSQL 14+
--
-- Aplicar:
--   createdb autoedit
--   psql -d autoedit -f db/schema.postgres.sql
--
-- O arquivo é idempotente: pode ser reaplicado sem erro (IF NOT EXISTS em tudo
-- que o Postgres permite). Ele NÃO apaga dados existentes.
--
-- Convenções adotadas:
--   * Chaves primárias são UUID v4 (gen_random_uuid, nativo no PG 13+ via
--     pgcrypto) — evita enumeração de IDs em URLs e facilita sincronizar dados
--     gerados offline pelo worker.
--   * Todo horário é TIMESTAMPTZ (armazenado em UTC). Nunca use TIMESTAMP puro:
--     ele perde o fuso e quebra quando o servidor muda de região.
--   * Exclusão é lógica (deleted_at) nas entidades que o usuário enxerga, e
--     física (ON DELETE CASCADE) nas tabelas de infraestrutura (sessões, tokens).
--   * Segredos (senha, refresh token, api key) nunca são guardados em texto —
--     apenas o hash. As colunas se chamam *_hash para deixar isso explícito.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Extensões
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- e-mail case-insensitive


-- -----------------------------------------------------------------------------
-- 1. Tipos enumerados
--    ENUM em vez de VARCHAR + CHECK: o Postgres valida, ocupa 4 bytes e o valor
--    aparece tipado no driver. Para adicionar valor depois:
--      ALTER TYPE user_role ADD VALUE 'reviewer';
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    CREATE TYPE user_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    -- pending  : criado, e-mail ainda não verificado
    -- active   : uso normal
    -- suspended: bloqueado por um admin
    -- deleted  : soft delete, mantido para integridade referencial
    CREATE TYPE user_status AS ENUM ('pending', 'active', 'suspended', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE auth_token_type AS ENUM ('email_verification', 'password_reset', 'invite');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE job_status AS ENUM ('queued', 'processing', 'done', 'error', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE job_item_status AS ENUM ('queued', 'processing', 'done', 'error', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE asset_kind AS ENUM ('template', 'upload', 'output');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- -----------------------------------------------------------------------------
-- 2. Gatilho genérico de updated_at
--    Deixa o banco responsável pelo carimbo, então nenhum caminho de escrita
--    (app, script de migração, psql manual) consegue esquecer de atualizar.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- -----------------------------------------------------------------------------
-- 3. Planos e limites
--    Tabela de referência: uma linha por plano comercial. Os limites ficam aqui
--    e não hardcoded no backend, então mudar preço/limite é UPDATE, não deploy.
--    Limite NULL = ilimitado.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
    code                    TEXT        PRIMARY KEY,
    name                    TEXT        NOT NULL,
    max_templates           INTEGER,
    max_jobs_per_day        INTEGER,
    max_videos_per_job      INTEGER,
    max_concurrent_jobs     INTEGER     NOT NULL DEFAULT 1,
    max_upload_mb           INTEGER,
    storage_quota_mb        INTEGER,
    is_active               BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at
    BEFORE UPDATE ON plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- 4. Usuários
--
--    password_hash guarda o resultado de Argon2id (recomendado) ou bcrypt.
--    Nunca guarde a senha, nem "criptografada" — hash com salt e custo é o
--    único formato aceitável. O prefixo do próprio hash ($argon2id$…, $2b$…)
--    identifica o algoritmo, então dá para migrar de bcrypt para Argon2 sem
--    coluna extra: rehash no próximo login bem-sucedido.
--
--    failed_login_count + locked_until implementam bloqueio progressivo contra
--    força bruta. O backend zera failed_login_count em todo login válido.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email                   CITEXT      NOT NULL,
    email_verified_at       TIMESTAMPTZ,
    password_hash           TEXT        NOT NULL,
    password_changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    display_name            TEXT        NOT NULL,
    avatar_url              TEXT,
    role                    user_role   NOT NULL DEFAULT 'member',
    status                  user_status NOT NULL DEFAULT 'pending',
    plan_code               TEXT        NOT NULL DEFAULT 'free'
                                        REFERENCES plans(code) ON UPDATE CASCADE,
    locale                  TEXT        NOT NULL DEFAULT 'pt-BR',
    timezone                TEXT        NOT NULL DEFAULT 'America/Sao_Paulo',
    failed_login_count      SMALLINT    NOT NULL DEFAULT 0,
    locked_until            TIMESTAMPTZ,
    last_login_at           TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,

    CONSTRAINT users_email_format_chk  CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    CONSTRAINT users_display_name_chk  CHECK (char_length(trim(display_name)) BETWEEN 1 AND 120)
);

-- Índice único parcial: o e-mail é único entre contas vivas, mas um endereço
-- pode ser reutilizado depois que a conta antiga foi excluída (soft delete).
CREATE UNIQUE INDEX IF NOT EXISTS users_email_active_uidx
    ON users (email) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS users_status_idx    ON users (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS users_plan_code_idx ON users (plan_code);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- 5. Sessões (refresh tokens)
--
--    Uma linha por dispositivo logado. O access token (JWT curto, 15 min) não
--    é persistido; só o refresh token, e mesmo assim apenas como SHA-256 —
--    um vazamento do banco não permite assumir sessão de ninguém.
--
--    Logout  = UPDATE sessions SET revoked_at = now() WHERE id = ...
--    Logout de todos os dispositivos = mesmo UPDATE filtrando por user_id.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash      TEXT        NOT NULL UNIQUE,
    user_agent              TEXT,
    ip_address              INET,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at              TIMESTAMPTZ NOT NULL,
    revoked_at              TIMESTAMPTZ,

    CONSTRAINT sessions_expiry_chk CHECK (expires_at > created_at)
);

-- Suporta a tela "dispositivos conectados" e a limpeza de sessões expiradas.
CREATE INDEX IF NOT EXISTS sessions_user_active_idx
    ON sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);


-- -----------------------------------------------------------------------------
-- 6. Tokens de uso único (verificar e-mail, resetar senha, convite)
--
--    Mesmo princípio das sessões: guarda-se o hash. consumed_at marca o uso e
--    impede replay — validar sempre com
--      WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_tokens (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type                    auth_token_type NOT NULL,
    token_hash              TEXT            NOT NULL UNIQUE,
    requested_ip            INET,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
    expires_at              TIMESTAMPTZ     NOT NULL,
    consumed_at             TIMESTAMPTZ,

    CONSTRAINT auth_tokens_expiry_chk CHECK (expires_at > created_at)
);

-- Um token pendente por tipo e usuário: pedir "esqueci a senha" duas vezes
-- invalida o anterior em vez de deixar dois links válidos circulando.
CREATE UNIQUE INDEX IF NOT EXISTS auth_tokens_pending_uidx
    ON auth_tokens (user_id, type) WHERE consumed_at IS NULL;


-- -----------------------------------------------------------------------------
-- 7. API keys (integração/automação sem navegador)
--
--    key_prefix são os primeiros caracteres da chave, guardados em claro só
--    para exibir "ae_live_3f9c…" na interface e para localizar a linha antes de
--    conferir o hash. O segredo completo aparece uma única vez, na criação.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                    TEXT        NOT NULL,
    key_prefix              TEXT        NOT NULL,
    key_hash                TEXT        NOT NULL UNIQUE,
    scopes                  TEXT[]      NOT NULL DEFAULT ARRAY['templates:read', 'jobs:write'],
    last_used_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at              TIMESTAMPTZ,
    revoked_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_user_idx    ON api_keys (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS api_keys_prefix_idx  ON api_keys (key_prefix);


-- -----------------------------------------------------------------------------
-- 8. Arquivos (media_assets)
--
--    Toda referência a arquivo em disco passa por aqui, em vez de espalhar
--    caminhos absolutos pelas tabelas. Resolve dois problemas concretos do
--    modelo atual:
--      a) duplicar um template hoje copia o file_path — dois registros apontam
--         para o mesmo arquivo e apagar um quebra o outro. Com asset_id + FK
--         RESTRICT o banco impede remover um arquivo ainda referenciado.
--      b) dois uploads chamados "video.mp4" se sobrescrevem. storage_key é
--         único e gerado pelo backend (uuid + extensão), enquanto
--         original_filename preserva o nome que o usuário reconhece.
--
--    checksum_sha256 permite deduplicar: se o mesmo arquivo já existe para o
--    usuário, reaproveite o asset em vez de gravar de novo.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_assets (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id                UUID        REFERENCES users(id) ON DELETE SET NULL,
    kind                    asset_kind  NOT NULL,
    storage_key             TEXT        NOT NULL UNIQUE,
    original_filename       TEXT        NOT NULL,
    mime_type               TEXT,
    size_bytes              BIGINT      NOT NULL DEFAULT 0,
    checksum_sha256         CHAR(64),
    width                   INTEGER,
    height                  INTEGER,
    duration_seconds        NUMERIC(10, 3),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,

    CONSTRAINT media_assets_size_chk CHECK (size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS media_assets_owner_kind_idx
    ON media_assets (owner_id, kind, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS media_assets_checksum_idx
    ON media_assets (owner_id, checksum_sha256) WHERE checksum_sha256 IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 9. Templates
--
--    Mesmos campos de composição da tabela SQLite atual, agora com dono,
--    referência a arquivo e compartilhamento. Os CHECK espelham as validações
--    que hoje só existem no frontend — o banco passa a ser a última linha de
--    defesa contra um overlay com largura zero ou um mix de áudio fora de 0..1.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_id                UUID        NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
    name                    TEXT        NOT NULL,

    -- Área onde o vídeo bruto é encaixado, em pixels da resolução de saída
    overlay_x               INTEGER     NOT NULL DEFAULT 0,
    overlay_y               INTEGER     NOT NULL DEFAULT 0,
    overlay_w               INTEGER     NOT NULL DEFAULT 1080,
    overlay_h               INTEGER     NOT NULL DEFAULT 1920,
    fit_mode                TEXT        NOT NULL DEFAULT 'cover',

    -- Saída
    output_w                INTEGER     NOT NULL DEFAULT 1080,
    output_h                INTEGER     NOT NULL DEFAULT 1920,
    output_format           TEXT        NOT NULL DEFAULT 'mp4',
    video_bitrate           TEXT        NOT NULL DEFAULT '8M',

    -- Áudio
    audio_source            TEXT        NOT NULL DEFAULT 'raw',
    audio_mix_raw           REAL        NOT NULL DEFAULT 1.0,
    audio_mix_template      REAL        NOT NULL DEFAULT 0.5,
    duration_rule           TEXT        NOT NULL DEFAULT 'raw',

    is_shared               BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ,

    CONSTRAINT templates_name_chk        CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
    CONSTRAINT templates_output_chk      CHECK (output_w BETWEEN 16 AND 7680 AND output_h BETWEEN 16 AND 7680),
    CONSTRAINT templates_overlay_pos_chk CHECK (overlay_x >= 0 AND overlay_y >= 0),
    CONSTRAINT templates_overlay_dim_chk CHECK (overlay_w > 0 AND overlay_h > 0),
    CONSTRAINT templates_overlay_fit_chk CHECK (overlay_x + overlay_w <= output_w
                                            AND overlay_y + overlay_h <= output_h),
    CONSTRAINT templates_fit_mode_chk    CHECK (fit_mode IN ('cover', 'contain')),
    CONSTRAINT templates_format_chk      CHECK (output_format IN ('mp4', 'mov', 'webm')),
    -- 'both' mixa os dois áudios usando audio_mix_raw/audio_mix_template;
    -- os nomes espelham exatamente o que services/composer.py aceita hoje.
    CONSTRAINT templates_audio_src_chk   CHECK (audio_source IN ('raw', 'template', 'both')),
    CONSTRAINT templates_audio_mix_chk   CHECK (audio_mix_raw BETWEEN 0 AND 1
                                            AND audio_mix_template BETWEEN 0 AND 1),
    CONSTRAINT templates_duration_chk    CHECK (duration_rule IN ('raw', 'template', 'loop_template'))
);

-- Nome único por usuário entre os templates vivos.
CREATE UNIQUE INDEX IF NOT EXISTS templates_user_name_uidx
    ON templates (user_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS templates_user_idx
    ON templates (user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS templates_shared_idx
    ON templates (is_shared) WHERE is_shared AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_templates_updated_at ON templates;
CREATE TRIGGER trg_templates_updated_at
    BEFORE UPDATE ON templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- 10. Jobs e itens
--
--     Hoje jobs vivem só em memória e somem quando o backend reinicia, junto
--     com o histórico. Persistindo aqui, um worker que caiu no meio consegue
--     retomar: basta procurar itens em 'processing' sem finished_at.
--
--     template_snapshot guarda os parâmetros de composição no instante em que o
--     job começou. Sem isso, editar o template depois faz o histórico mentir
--     sobre como cada vídeo foi gerado.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id             UUID        REFERENCES templates(id) ON DELETE SET NULL,
    template_snapshot       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    status                  job_status  NOT NULL DEFAULT 'queued',
    total_items             INTEGER     NOT NULL DEFAULT 0,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at              TIMESTAMPTZ,
    finished_at             TIMESTAMPTZ,

    CONSTRAINT jobs_total_items_chk CHECK (total_items >= 0)
);

CREATE INDEX IF NOT EXISTS jobs_user_created_idx ON jobs (user_id, created_at DESC);
-- Fila do worker: só as linhas que ainda interessam entram no índice.
CREATE INDEX IF NOT EXISTS jobs_queue_idx
    ON jobs (created_at) WHERE status IN ('queued', 'processing');


CREATE TABLE IF NOT EXISTS job_items (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                  UUID            NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    source_asset_id         UUID            NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
    output_asset_id         UUID            REFERENCES media_assets(id) ON DELETE SET NULL,
    position                INTEGER         NOT NULL DEFAULT 0,
    status                  job_item_status NOT NULL DEFAULT 'queued',
    progress                SMALLINT        NOT NULL DEFAULT 0,
    attempt_count           SMALLINT        NOT NULL DEFAULT 0,
    error_msg               TEXT,
    log_path                TEXT,
    started_at              TIMESTAMPTZ,
    finished_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT job_items_progress_chk CHECK (progress BETWEEN 0 AND 100),
    -- Um item concluído tem saída; um item com erro tem mensagem.
    CONSTRAINT job_items_done_chk     CHECK (status <> 'done'  OR output_asset_id IS NOT NULL),
    CONSTRAINT job_items_error_chk    CHECK (status <> 'error' OR error_msg IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS job_items_job_idx    ON job_items (job_id, position);
CREATE INDEX IF NOT EXISTS job_items_status_idx ON job_items (status) WHERE status IN ('queued', 'processing');


-- -----------------------------------------------------------------------------
-- 11. Consumo diário (aplicação de quota)
--
--     Contadores agregados por dia. Bem mais barato que fazer COUNT(*) em jobs
--     a cada requisição. Incremento atômico:
--
--       INSERT INTO usage_counters (user_id, day, jobs_created)
--       VALUES ($1, current_date, 1)
--       ON CONFLICT (user_id, day)
--       DO UPDATE SET jobs_created = usage_counters.jobs_created + 1;
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_counters (
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day                     DATE        NOT NULL DEFAULT current_date,
    jobs_created            INTEGER     NOT NULL DEFAULT 0,
    videos_processed        INTEGER     NOT NULL DEFAULT 0,
    bytes_uploaded          BIGINT      NOT NULL DEFAULT 0,
    seconds_rendered        INTEGER     NOT NULL DEFAULT 0,

    PRIMARY KEY (user_id, day)
);


-- -----------------------------------------------------------------------------
-- 12. Auditoria
--
--     Trilha append-only do que aconteceu. Guarde aqui login, troca de senha,
--     exclusão de template, mudança de plano — tudo que você vai querer
--     explicar meses depois. BIGSERIAL em vez de UUID porque esta tabela é
--     escrita em volume e nunca exposta por URL.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id                      BIGSERIAL   PRIMARY KEY,
    user_id                 UUID        REFERENCES users(id) ON DELETE SET NULL,
    action                  TEXT        NOT NULL,
    entity_type             TEXT,
    entity_id               UUID,
    ip_address              INET,
    user_agent              TEXT,
    metadata                JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_user_idx   ON audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id);


-- -----------------------------------------------------------------------------
-- 13. Views de apoio
-- -----------------------------------------------------------------------------

-- Uso do dia contra os limites do plano. Uma consulta só para decidir se o
-- usuário pode disparar mais um job.
CREATE OR REPLACE VIEW v_user_quota AS
SELECT
    u.id                                        AS user_id,
    u.email,
    u.plan_code,
    p.max_jobs_per_day,
    p.max_concurrent_jobs,
    p.max_templates,
    p.storage_quota_mb,
    COALESCE(c.jobs_created, 0)                 AS jobs_today,
    COALESCE(c.videos_processed, 0)             AS videos_today,
    (SELECT count(*) FROM templates t
      WHERE t.user_id = u.id AND t.deleted_at IS NULL)          AS templates_count,
    (SELECT count(*) FROM jobs j
      WHERE j.user_id = u.id AND j.status IN ('queued', 'processing')) AS jobs_running,
    COALESCE((SELECT sum(a.size_bytes) FROM media_assets a
      WHERE a.owner_id = u.id AND a.deleted_at IS NULL), 0) / 1048576.0 AS storage_used_mb
FROM users u
JOIN plans p ON p.code = u.plan_code
LEFT JOIN usage_counters c ON c.user_id = u.id AND c.day = current_date
WHERE u.deleted_at IS NULL;


-- Jobs com o progresso agregado dos itens — evita N+1 na tela de processamento.
CREATE OR REPLACE VIEW v_job_progress AS
SELECT
    j.id                AS job_id,
    j.user_id,
    j.template_id,
    j.status,
    j.created_at,
    j.started_at,
    j.finished_at,
    count(i.id)                                                  AS items_total,
    count(*) FILTER (WHERE i.status = 'done')                    AS items_done,
    count(*) FILTER (WHERE i.status = 'error')                   AS items_error,
    COALESCE(round(avg(i.progress)), 0)::SMALLINT                AS progress_avg
FROM jobs j
LEFT JOIN job_items i ON i.job_id = j.id
GROUP BY j.id;


-- -----------------------------------------------------------------------------
-- 14. Row Level Security (opcional)
--
--     Ative se o backend for conectar com um papel por usuário ou definir
--     `SET LOCAL app.current_user_id` no início de cada transação. Vira uma
--     rede de segurança: mesmo um WHERE esquecido no código não vaza dado de
--     outro usuário. Deixado comentado porque exige que a aplicação passe a
--     setar a variável — ligar sem isso derruba todas as consultas.
--
--     ALTER TABLE templates    ENABLE ROW LEVEL SECURITY;
--     ALTER TABLE jobs         ENABLE ROW LEVEL SECURITY;
--     ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
--
--     CREATE POLICY templates_owner ON templates
--         USING (user_id = current_setting('app.current_user_id', TRUE)::uuid);
--
--     CREATE POLICY jobs_owner ON jobs
--         USING (user_id = current_setting('app.current_user_id', TRUE)::uuid);
--
--     CREATE POLICY assets_owner ON media_assets
--         USING (owner_id = current_setting('app.current_user_id', TRUE)::uuid);
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 15. Dados iniciais
--     Só os planos. Nenhum usuário é criado aqui: criar admin com senha fixa em
--     arquivo versionado é como o vazamento começa. Gere o primeiro usuário
--     pelo backend, com hash Argon2id de uma senha que você escolheu.
-- -----------------------------------------------------------------------------
INSERT INTO plans (code, name, max_templates, max_jobs_per_day, max_videos_per_job,
                   max_concurrent_jobs, max_upload_mb, storage_quota_mb)
VALUES
    ('free', 'Gratuito',  3,    5,   10,  1,  200,   1024),
    ('pro',  'Pro',       50,   200, 100, 3,  2048,  51200),
    ('team', 'Equipe',    NULL, NULL, NULL, 8, 8192, 512000)
ON CONFLICT (code) DO NOTHING;

COMMIT;


-- =============================================================================
-- Rotinas de manutenção
-- Agende via cron/pg_cron. Sessões e tokens expirados não têm valor e só fazem
-- os índices crescerem.
-- =============================================================================
-- DELETE FROM sessions    WHERE expires_at < now() - INTERVAL '30 days';
-- DELETE FROM auth_tokens WHERE expires_at < now() - INTERVAL '7 days';
-- DELETE FROM audit_log   WHERE created_at < now() - INTERVAL '1 year';
