-- =============================================================
-- TAO App — Schema Inicial (Sprint 1 + 2)
-- Encoding: UTF-8
-- =============================================================

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA encoding="UTF-8";

-- -------------------------------------------------------------
-- 1. PASTAS — árvore hierárquica dinâmica da sidebar
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pastas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id   INTEGER REFERENCES pastas(id) ON DELETE CASCADE,
    nome        TEXT NOT NULL,
    nivel       INTEGER NOT NULL DEFAULT 0,
    ordem       INTEGER NOT NULL DEFAULT 0,
    criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para navegação hierárquica eficiente
CREATE INDEX IF NOT EXISTS idx_pastas_parent ON pastas(parent_id);
CREATE INDEX IF NOT EXISTS idx_pastas_nivel  ON pastas(nivel);

-- -------------------------------------------------------------
-- 2. DOCUMENTOS — arquivos mestres (coluna esquerda)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documentos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    pasta_id      INTEGER NOT NULL REFERENCES pastas(id) ON DELETE CASCADE,
    titulo        TEXT NOT NULL,
    descricao     TEXT,
    ordem         INTEGER NOT NULL DEFAULT 0,
    criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_docs_pasta ON documentos(pasta_id);

-- Trigger: atualiza atualizado_em automaticamente ao editar documento
CREATE TRIGGER IF NOT EXISTS trig_docs_updated
AFTER UPDATE ON documentos
BEGIN
    UPDATE documentos SET atualizado_em = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- -------------------------------------------------------------
-- 3. BLOCOS ATÔMICOS — cada artigo, parágrafo, inciso, alínea
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blocos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_id    INTEGER NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,

    -- Identificação estrutural
    tipo            TEXT NOT NULL DEFAULT 'texto_livre'
                        CHECK(tipo IN ('artigo','paragrafo','inciso','alinea','cabecalho','texto_livre')),
    identificador   TEXT,               -- Ex: "Art. 5º", "§ 1º", "I —", "a)"
    conteudo        TEXT NOT NULL DEFAULT '',
    ordem           INTEGER NOT NULL DEFAULT 0,

    -- ── HEATMAP (Importância) ─────────────────────────────────
    importancia     TEXT NOT NULL DEFAULT 'normal'
                        CHECK(importancia IN ('normal','importante','vital')),

    -- ── FSRS (Free Spaced Repetition Scheduler) ───────────────
    -- Campos baseados no algoritmo FSRS v4
    revisado        BOOLEAN NOT NULL DEFAULT 0,  -- checkbox do usuário
    last_review     DATE,                        -- última revisão manual
    next_review     DATE,                        -- próxima revisão calculada
    stability       REAL NOT NULL DEFAULT 1.0,   -- estabilidade da memória
    difficulty      REAL NOT NULL DEFAULT 0.3,   -- dificuldade percebida (0-1)
    reps            INTEGER NOT NULL DEFAULT 0,  -- repetições bem-sucedidas
    lapses          INTEGER NOT NULL DEFAULT 0,  -- vezes que esqueceu

    -- ── Sincronização vetorial ───────────────────────────────
    chroma_synced   BOOLEAN NOT NULL DEFAULT 0,  -- já foi enviado ao ChromaDB?
    chroma_id       TEXT,                        -- ID correspondente no ChromaDB

    criado_em       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_blocos_documento ON blocos(documento_id);
CREATE INDEX IF NOT EXISTS idx_blocos_ordem      ON blocos(documento_id, ordem);
CREATE INDEX IF NOT EXISTS idx_blocos_revisao    ON blocos(next_review);
CREATE INDEX IF NOT EXISTS idx_blocos_importancia ON blocos(importancia);

-- Trigger: atualiza timestamp ao editar bloco
CREATE TRIGGER IF NOT EXISTS trig_blocos_updated
AFTER UPDATE ON blocos
BEGIN
    UPDATE blocos SET atualizado_em = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- -------------------------------------------------------------
-- 4. FTS5 — busca de texto completo para Portais [[...]]
-- -------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS blocos_fts USING fts5(
    conteudo,
    identificador,
    content='blocos',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);

-- Triggers para manter FTS sincronizado com a tabela blocos
CREATE TRIGGER IF NOT EXISTS blocos_fts_insert
AFTER INSERT ON blocos BEGIN
    INSERT INTO blocos_fts(rowid, conteudo, identificador)
    VALUES (NEW.id, NEW.conteudo, NEW.identificador);
END;

CREATE TRIGGER IF NOT EXISTS blocos_fts_update
AFTER UPDATE ON blocos BEGIN
    INSERT INTO blocos_fts(blocos_fts, rowid, conteudo, identificador)
    VALUES ('delete', OLD.id, OLD.conteudo, OLD.identificador);
    INSERT INTO blocos_fts(rowid, conteudo, identificador)
    VALUES (NEW.id, NEW.conteudo, NEW.identificador);
END;

CREATE TRIGGER IF NOT EXISTS blocos_fts_delete
AFTER DELETE ON blocos BEGIN
    INSERT INTO blocos_fts(blocos_fts, rowid, conteudo, identificador)
    VALUES ('delete', OLD.id, OLD.conteudo, OLD.identificador);
END;

-- -------------------------------------------------------------
-- 5. ANOTAÇÕES DE LINK — blocos da coluna direita
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anotacoes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    bloco_id        INTEGER NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
    tipo            TEXT NOT NULL DEFAULT 'texto'
                        CHECK(tipo IN ('texto','tabela','fluxograma','portal')),
    conteudo        TEXT NOT NULL DEFAULT '',
    ordem           INTEGER NOT NULL DEFAULT 0,
    criado_em       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_anotacoes_bloco ON anotacoes(bloco_id);

CREATE TRIGGER IF NOT EXISTS trig_anotacoes_updated
AFTER UPDATE ON anotacoes
BEGIN
    UPDATE anotacoes SET atualizado_em = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- -------------------------------------------------------------
-- 6. PORTAIS — referências cruzadas entre blocos
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portais (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    bloco_origem_id     INTEGER NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
    bloco_alvo_id       INTEGER NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
    criado_em           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(bloco_origem_id, bloco_alvo_id)
);

-- -------------------------------------------------------------
-- 7. MATERIAL DE APOIO — arquivos enviados via upload
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS materiais (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nome_arquivo    TEXT NOT NULL,
    tipo            TEXT NOT NULL CHECK(tipo IN ('pdf','docx','txt')),
    caminho         TEXT NOT NULL UNIQUE,
    tamanho_bytes   INTEGER,
    chroma_synced   BOOLEAN NOT NULL DEFAULT 0,
    criado_em       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------------
-- 8. DADOS INICIAIS — estrutura padrão de pastas (Nível 0 e 1)
-- -------------------------------------------------------------
INSERT OR IGNORE INTO pastas (id, parent_id, nome, nivel, ordem)
VALUES
    (1,  NULL, 'TAO',                    0, 0),
    (2,  1,    'Legislação',             1, 1),
    (3,  1,    'Doutrina',               1, 2),
    (4,  1,    'Jurisprudência',         1, 3),
    (5,  1,    'Coordenadorias Nacionais', 1, 4),
    (6,  1,    'Questões',               1, 5),
    (7,  1,    'Material de Apoio',      1, 6),
    (8,  1,    'Sumário de Notas',       1, 7),
    (9,  1,    'Rascunhos',              1, 8);

-- Subpastas de Legislação (Nível 2)
INSERT OR IGNORE INTO pastas (parent_id, nome, nivel, ordem)
VALUES
    (2, 'Constituição',            2, 1),
    (2, 'Código Civil',            2, 2),
    (2, 'Código de Processo Civil', 2, 3),
    (2, 'Código Penal',            2, 4),
    (2, 'Legislação Internacional', 2, 5),
    (2, 'Legislação Extravagante', 2, 6);
