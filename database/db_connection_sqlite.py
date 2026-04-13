"""
database/db_connection_sqlite.py
Backend SQLite — preservado intacto do Sprint 1-7.

Para comutar de volta para SQLite em emergência:
    Em database/db_connection.py, altere DB_MODE_DEFAULT = "sqlite"
    ou defina st.session_state["db_mode"] = "sqlite" na sidebar.
"""

import sqlite3
import os
import streamlit as st
from pathlib import Path

# Caminho absoluto da raiz do projeto (dois níveis acima deste arquivo)
BASE_DIR   = Path(__file__).resolve().parent.parent
DB_PATH    = BASE_DIR / "database" / "tao.db"
SCHEMA_PATH = BASE_DIR / "database" / "schema.sql"


@st.cache_resource
def get_connection() -> sqlite3.Connection:
    """
    Retorna uma conexão SQLite persistente para toda a sessão do Streamlit.
    - Habilita WAL mode para melhor concorrência.
    - Habilita foreign keys.
    - Aplica o schema.sql se o banco ainda não existir.
    - row_factory = sqlite3.Row permite acessar colunas por nome.
    """
    db_path = str(DB_PATH)
    is_new  = not os.path.exists(db_path)

    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row

    # Configurações de performance e integridade
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA cache_size=-16000;")   # ~16 MB de cache em memória

    if is_new:
        _apply_schema(conn)
    else:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='blocos' LIMIT 1"
        ).fetchone()
        if row is None:
            # tao.db existe mas sem schema (ex.: ficheiro vazio na nuvem) — evita
            # _run_migrations falhar com "no such table: blocos"
            _apply_schema(conn)

    _run_migrations(conn)
    return conn


def _apply_schema(conn: sqlite3.Connection) -> None:
    """Lê o schema.sql e executa no banco recém-criado."""
    if not SCHEMA_PATH.exists():
        raise FileNotFoundError(
            f"Schema não encontrado em: {SCHEMA_PATH}\n"
            "Verifique se o arquivo database/schema.sql existe."
        )
    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(schema_sql)
    conn.commit()


def _run_migrations(conn: sqlite3.Connection) -> None:
    """
    Migrações incrementais de schema — seguras para bancos já existentes.
    Cada ALTER TABLE só é executado se a coluna ainda não existir.
    Tabelas novas são criadas via CREATE TABLE IF NOT EXISTS.
    """
    # ── Sprint 5: novas colunas em blocos ────────────────────────
    existing_blocos = {row[1] for row in conn.execute("PRAGMA table_info(blocos)")}
    col_migrations = [
        ("cor_fonte",   "ALTER TABLE blocos ADD COLUMN cor_fonte   TEXT NOT NULL DEFAULT 'preto'"),
        ("alinhamento", "ALTER TABLE blocos ADD COLUMN alinhamento TEXT NOT NULL DEFAULT 'justificado'"),
        # Sprint 9: estado do card FSRS (0=New, 1=Learning, 2=Review, 3=Relearning)
        ("fsrs_state",  "ALTER TABLE blocos ADD COLUMN fsrs_state  INTEGER NOT NULL DEFAULT 0"),
    ]
    changed = False
    for col, sql in col_migrations:
        if col not in existing_blocos:
            conn.execute(sql)
            changed = True

    # ── Ordem de documentos na sidebar (mesmo nível dentro da pasta) ──
    existing_docs = {row[1] for row in conn.execute("PRAGMA table_info(documentos)")}
    if "documentos" in {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}:
        if "ordem" not in existing_docs:
            conn.execute(
                "ALTER TABLE documentos ADD COLUMN ordem INTEGER NOT NULL DEFAULT 0"
            )
            changed = True
            for row in conn.execute(
                "SELECT DISTINCT pasta_id FROM documentos"
            ).fetchall():
                pid = row[0]
                docs = conn.execute(
                    "SELECT id FROM documentos WHERE pasta_id=? "
                    "ORDER BY titulo COLLATE NOCASE, id",
                    (pid,),
                ).fetchall()
                for i, (did,) in enumerate(docs, start=1):
                    conn.execute(
                        "UPDATE documentos SET ordem=? WHERE id=?", (i, did)
                    )

    # ── Sprint 6: tabela materiais ───────────────────────────────
    conn.execute("""
        CREATE TABLE IF NOT EXISTS materiais (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            nome_arquivo    TEXT NOT NULL,
            tipo            TEXT NOT NULL CHECK(tipo IN ('pdf','docx','txt')),
            caminho         TEXT NOT NULL UNIQUE,
            tamanho_bytes   INTEGER,
            chroma_synced   BOOLEAN NOT NULL DEFAULT 0,
            criado_em       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    changed = True

    # ── Sprint 10: tabela questoes, quiz_resultados e questao_itens ──
    _tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}

    # Se questoes ainda não existe, cria com CHECK completo
    if "questoes" not in _tables:
        conn.execute("""
            CREATE TABLE questoes (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                banca           TEXT,
                ano             INTEGER,
                cargo           TEXT,
                materia         TEXT NOT NULL DEFAULT '',
                tipo            TEXT NOT NULL DEFAULT 'multipla_escolha'
                                    CHECK(tipo IN (
                                        'multipla_escolha',
                                        'certo_errado',
                                        'combinacao_itens'
                                    )),
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
                criado_em       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
    elif "questao_itens" not in _tables:
        # questoes existe mas foi criada com o CHECK antigo (Sprint 10 original):
        # recria preservando os dados existentes
        conn.executescript("""
            CREATE TABLE questoes_v2 (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                banca           TEXT,
                ano             INTEGER,
                cargo           TEXT,
                materia         TEXT NOT NULL DEFAULT '',
                tipo            TEXT NOT NULL DEFAULT 'multipla_escolha'
                                    CHECK(tipo IN (
                                        'multipla_escolha',
                                        'certo_errado',
                                        'combinacao_itens'
                                    )),
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
                criado_em       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            INSERT OR IGNORE INTO questoes_v2 SELECT * FROM questoes;
            DROP TABLE questoes;
            ALTER TABLE questoes_v2 RENAME TO questoes;
        """)

    # questao_itens — afirmações romanas (I, II, III…) para combinacao_itens
    conn.execute("""
        CREATE TABLE IF NOT EXISTS questao_itens (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            questao_id  INTEGER NOT NULL REFERENCES questoes(id) ON DELETE CASCADE,
            numero      TEXT NOT NULL,
            enunciado   TEXT NOT NULL,
            correto     INTEGER DEFAULT NULL,
            ordem       INTEGER NOT NULL DEFAULT 0
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS quiz_resultados (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            questao_id    INTEGER REFERENCES questoes(id) ON DELETE CASCADE,
            acertou       BOOLEAN NOT NULL,
            respondido_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    changed = True

    if changed:
        conn.commit()


def ensure_schema(conn: sqlite3.Connection) -> None:
    """
    Força a reaplicação do schema (útil em migrações manuais).
    Chamar apenas quando necessário — não no fluxo normal.
    """
    _apply_schema(conn)


# ── Funções auxiliares de CRUD genérico ─────────────────────────────────────

def fetchall(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list:
    """Executa SELECT e retorna lista de sqlite3.Row."""
    cur = conn.execute(sql, params)
    return cur.fetchall()


def fetchone(conn: sqlite3.Connection, sql: str, params: tuple = ()):
    """Executa SELECT e retorna um único sqlite3.Row ou None."""
    cur = conn.execute(sql, params)
    return cur.fetchone()


def execute(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> int:
    """
    Executa INSERT/UPDATE/DELETE.
    Retorna o lastrowid para INSERT, ou rowcount para outros.
    Faz commit automático.
    """
    cur = conn.execute(sql, params)
    conn.commit()
    return cur.lastrowid if cur.lastrowid else cur.rowcount


def executemany(conn: sqlite3.Connection, sql: str, params_list: list) -> None:
    """Executa um batch de INSERT/UPDATE/DELETE com commit único."""
    conn.executemany(sql, params_list)
    conn.commit()
