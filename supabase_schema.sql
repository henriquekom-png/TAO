-- =============================================================
-- TAO App — Schema PostgreSQL (Supabase)
-- Sprint 8A
--
-- INSTRUÇÕES:
--   1. Abra o Supabase Dashboard → SQL Editor
--   2. Cole TODO este conteúdo e clique em "Run"
--   3. Confirme que todas as tabelas aparecem em Table Editor
-- =============================================================

-- -------------------------------------------------------------
-- Extensão para UUID (opcional, não usada aqui mas boa prática)
-- -------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS unaccent;

-- -------------------------------------------------------------
-- 1. PASTAS — árvore hierárquica dinâmica da sidebar
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pastas (
    id          INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    parent_id   INTEGER REFERENCES pastas(id) ON DELETE CASCADE,
    nome        TEXT    NOT NULL,
    nivel       INTEGER NOT NULL DEFAULT 0,
    ordem       INTEGER NOT NULL DEFAULT 0,
    criado_em   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pastas_parent ON pastas(parent_id);
CREATE INDEX IF NOT EXISTS idx_pastas_nivel  ON pastas(nivel);

-- -------------------------------------------------------------
-- 2. DOCUMENTOS — arquivos mestres (coluna esquerda)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documentos (
    id            INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    pasta_id      INTEGER NOT NULL REFERENCES pastas(id) ON DELETE CASCADE,
    titulo        TEXT    NOT NULL,
    descricao     TEXT,
    ordem         INTEGER NOT NULL DEFAULT 0,
    criado_em     TIMESTAMPTZ DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docs_pasta ON documentos(pasta_id);

-- Trigger: atualiza atualizado_em automaticamente
CREATE OR REPLACE FUNCTION _tao_set_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_docs_updated ON documentos;
CREATE TRIGGER trig_docs_updated
    BEFORE UPDATE ON documentos
    FOR EACH ROW EXECUTE FUNCTION _tao_set_atualizado_em();

-- -------------------------------------------------------------
-- 3. BLOCOS ATÔMICOS — artigos, parágrafos, incisos, alíneas
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blocos (
    id              INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    documento_id    INTEGER NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,

    -- Identificação estrutural
    tipo            TEXT    NOT NULL DEFAULT 'texto_livre'
                        CHECK(tipo IN ('artigo','paragrafo','inciso','alinea','cabecalho','texto_livre')),
    identificador   TEXT,
    conteudo        TEXT    NOT NULL DEFAULT '',
    ordem           INTEGER NOT NULL DEFAULT 0,

    -- ── HEATMAP ──────────────────────────────────────────────
    importancia     TEXT    NOT NULL DEFAULT 'normal'
                        CHECK(importancia IN ('normal','importante','vital')),

    -- ── Formatação visual ─────────────────────────────────────
    cor_fonte       TEXT    NOT NULL DEFAULT 'preto',
    alinhamento     TEXT    NOT NULL DEFAULT 'justificado',

    -- ── FSRS ─────────────────────────────────────────────────
    revisado        BOOLEAN NOT NULL DEFAULT FALSE,
    last_review     DATE,
    next_review     DATE,
    stability       DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    difficulty      DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    reps            INTEGER NOT NULL DEFAULT 0,
    lapses          INTEGER NOT NULL DEFAULT 0,

    -- ── ChromaDB sync ────────────────────────────────────────
    chroma_synced   BOOLEAN NOT NULL DEFAULT FALSE,
    chroma_id       TEXT,

    criado_em       TIMESTAMPTZ DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blocos_documento  ON blocos(documento_id);
CREATE INDEX IF NOT EXISTS idx_blocos_ordem      ON blocos(documento_id, ordem);
CREATE INDEX IF NOT EXISTS idx_blocos_revisao    ON blocos(next_review);
CREATE INDEX IF NOT EXISTS idx_blocos_importancia ON blocos(importancia);

DROP TRIGGER IF EXISTS trig_blocos_updated ON blocos;
CREATE TRIGGER trig_blocos_updated
    BEFORE UPDATE ON blocos
    FOR EACH ROW EXECUTE FUNCTION _tao_set_atualizado_em();

-- ── Full-Text Search (substitui FTS5 do SQLite) ───────────────
-- Coluna gerada automaticamente com vetor de busca em português
ALTER TABLE blocos
    ADD COLUMN IF NOT EXISTS fts_vector tsvector
    GENERATED ALWAYS AS (
        to_tsvector(
            'portuguese',
            coalesce(conteudo, '') || ' ' || coalesce(identificador, '')
        )
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_blocos_fts ON blocos USING GIN(fts_vector);

-- NOTA PARA O DESENVOLVEDOR:
-- A query FTS no código foi adaptada automaticamente pelo db_connection_supabase.py.
-- SQLite:     WHERE blocos_fts MATCH ?
-- PostgreSQL: WHERE b.fts_vector @@ plainto_tsquery('portuguese', %s)

-- -------------------------------------------------------------
-- 4. ANOTAÇÕES DE LINK — conteúdo da coluna direita
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anotacoes (
    id              INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    bloco_id        INTEGER NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
    tipo            TEXT    NOT NULL DEFAULT 'texto'
                        CHECK(tipo IN ('texto','tabela','fluxograma','portal')),
    conteudo        TEXT    NOT NULL DEFAULT '',
    ordem           INTEGER NOT NULL DEFAULT 0,
    criado_em       TIMESTAMPTZ DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anotacoes_bloco ON anotacoes(bloco_id);

DROP TRIGGER IF EXISTS trig_anotacoes_updated ON anotacoes;
CREATE TRIGGER trig_anotacoes_updated
    BEFORE UPDATE ON anotacoes
    FOR EACH ROW EXECUTE FUNCTION _tao_set_atualizado_em();

-- -------------------------------------------------------------
-- 5. PORTAIS — referências cruzadas entre blocos
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portais (
    id                  INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    bloco_origem_id     INTEGER NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
    bloco_alvo_id       INTEGER NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
    criado_em           TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(bloco_origem_id, bloco_alvo_id)
);

-- -------------------------------------------------------------
-- 6. MATERIAL DE APOIO
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS materiais (
    id              INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    nome_arquivo    TEXT    NOT NULL,
    tipo            TEXT    NOT NULL CHECK(tipo IN ('pdf','docx','txt')),
    caminho         TEXT    NOT NULL UNIQUE,
    tamanho_bytes   INTEGER,
    chroma_synced   BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em       TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 7. QUESTÕES DE CONCURSO — Sprint 10
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS questoes (
    id              INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    banca           TEXT,
    ano             INTEGER,
    cargo           TEXT,
    materia         TEXT NOT NULL DEFAULT '',
    tipo            TEXT NOT NULL DEFAULT 'multipla_escolha'
                        CHECK(tipo IN ('multipla_escolha','certo_errado','combinacao_itens')),
    enunciado       TEXT NOT NULL,
    alternativa_a   TEXT,
    alternativa_b   TEXT,
    alternativa_c   TEXT,
    alternativa_d   TEXT,
    alternativa_e   TEXT,
    gabarito        TEXT NOT NULL,
    comentario      TEXT,
    dificuldade     TEXT NOT NULL DEFAULT 'media'
                        CHECK(dificuldade IN ('facil','media','dificil')),
    bloco_origem_id INTEGER REFERENCES blocos(id) ON DELETE SET NULL,
    criado_em       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS questao_itens (
    id          INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    questao_id  INTEGER NOT NULL REFERENCES questoes(id) ON DELETE CASCADE,
    numero      TEXT NOT NULL,
    enunciado   TEXT NOT NULL,
    correto     BOOLEAN DEFAULT NULL,
    ordem       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_qitens_questao ON questao_itens(questao_id);

CREATE TABLE IF NOT EXISTS quiz_resultados (
    id            INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    questao_id    INTEGER REFERENCES questoes(id) ON DELETE CASCADE,
    acertou       BOOLEAN NOT NULL,
    respondido_em TIMESTAMPTZ DEFAULT NOW()
);

-- -------------------------------------------------------------
-- 8. DADOS INICIAIS — pastas padrão do TAO
-- -------------------------------------------------------------
INSERT INTO pastas (id, parent_id, nome, nivel, ordem)
OVERRIDING SYSTEM VALUE
VALUES
    (1,  NULL, 'TAO',                      0, 0),
    (2,  1,    'Legislação',               1, 1),
    (3,  1,    'Doutrina',                 1, 2),
    (4,  1,    'Jurisprudência',           1, 3),
    (5,  1,    'Coordenadorias Nacionais', 1, 4),
    (6,  1,    'Questões',                 1, 5),
    (7,  1,    'Material de Apoio',        1, 6),
    (8,  1,    'Sumário de Notas',         1, 7),
    (9,  1,    'Rascunhos',               1, 8)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pastas (parent_id, nome, nivel, ordem)
VALUES
    (2, 'Constituição',             2, 1),
    (2, 'Código Civil',             2, 2),
    (2, 'Código de Processo Civil', 2, 3),
    (2, 'Código Penal',             2, 4),
    (2, 'Legislação Internacional', 2, 5),
    (2, 'Legislação Extravagante',  2, 6)
ON CONFLICT DO NOTHING;

-- Reseta a sequência para continuar após os IDs inseridos manualmente
SELECT setval(pg_get_serial_sequence('pastas','id'), MAX(id)) FROM pastas;

-- Bases já existentes: adiciona coluna de ordenação de documentos na sidebar
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS ordem INTEGER NOT NULL DEFAULT 0;
