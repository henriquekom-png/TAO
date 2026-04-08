"""
database/db_connection_supabase.py
Backend Supabase — conecta via psycopg2 direto ao PostgreSQL do Supabase.

CREDENCIAIS necessárias em .streamlit/secrets.toml:
    SUPABASE_DB_URL = "postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"

Como obter a URL:
    Supabase Dashboard → Settings → Database
    → Connection String → URI (modo "Transaction" ou "Session")

Para comutar de volta para SQLite em emergência:
    Em db_connection.py, altere DB_MODE_DEFAULT = "sqlite"
    ou force st.session_state["db_mode"] = "sqlite".

Por que psycopg2 e não supabase-py?
    Toda a base de código usa SQL puro (fetchall/fetchone/execute).
    psycopg2 permite reutilizar 100% dessas queries sem reescrita.
    O único ajuste necessário é ? → %s nos placeholders.
"""

import re
import streamlit as st
import psycopg2
import psycopg2.extras

# Tabelas com coluna id gerada por IDENTITY/SERIAL (ordem irrelevante aqui)
_TAO_ID_TABLES = (
    "pastas",
    "documentos",
    "blocos",
    "anotacoes",
    "portais",
    "materiais",
    "questoes",
    "questao_itens",
    "quiz_resultados",
)


def repair_identity_sequences(conn, *, do_commit: bool = False) -> None:
    """
    Alinha sequências PostgreSQL ao MAX(id) de cada tabela.

    Necessário após INSERT com OVERRIDING SYSTEM VALUE (ex.: sync SQLite→nuvem):
    esses INSERTs não avançam a sequência, e o próximo DEFAULT id colide (UniqueViolation).
    """
    try:
        with conn.cursor() as cur:
            for table in _TAO_ID_TABLES:
                try:
                    cur.execute(
                        "SELECT pg_get_serial_sequence(%s, 'id')",
                        (table,),
                    )
                    row = cur.fetchone()
                    seq = row[0] if row else None
                    if not seq:
                        continue
                    cur.execute(f"SELECT COALESCE(MAX(id), 0) FROM {table}")
                    mx = cur.fetchone()[0]
                    cur.execute("SELECT setval(%s, %s, true)", (seq, int(mx)))
                except Exception:
                    continue
        if do_commit:
            conn.commit()
    except Exception:
        conn.rollback()
        raise


# ── Conexão ───────────────────────────────────────────────────────────────────

@st.cache_resource(show_spinner="Conectando ao Supabase…")
def get_connection():
    """
    Retorna conexão psycopg2 persistente ao PostgreSQL do Supabase.
    Usa RealDictCursor como padrão para que row["coluna"] funcione
    da mesma forma que sqlite3.Row.
    """
    try:
        db_url = st.secrets["SUPABASE_DB_URL"]
    except Exception:
        raise RuntimeError(
            "Credencial SUPABASE_DB_URL não encontrada.\n"
            "Adicione em .streamlit/secrets.toml:\n"
            '  SUPABASE_DB_URL = "postgresql://postgres.[ref]:[senha]@...supabase.com:6543/postgres"'
        )

    # sslmode já pode estar embutido na URL; passar como kwarg separado
    # causa conflito em algumas versões do psycopg2. Adicionamos à URL se ausente.
    if "sslmode=" not in db_url:
        sep = "&" if "?" in db_url else "?"
        db_url = f"{db_url}{sep}sslmode=require"
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    repair_identity_sequences(conn, do_commit=False)
    conn.commit()
    return conn


# ── Adaptação de SQL: SQLite → PostgreSQL ─────────────────────────────────────

def _adapt_sql(sql: str) -> str:
    """
    Converte SQL SQLite para PostgreSQL:
      1. Substitui '?' por '%s' nos placeholders de parâmetros.
      2. Adapta query FTS5 (blocos_fts MATCH) para tsvector PostgreSQL.
    """
    # 1. Placeholders
    adapted = sql.replace("?", "%s")

    # 2. FTS: converte "blocos_fts MATCH %s" → "b.fts_vector @@ plainto_tsquery('portuguese', %s)"
    adapted = re.sub(
        r"blocos_fts\s+MATCH\s+%s",
        "b.fts_vector @@ plainto_tsquery('portuguese', %s)",
        adapted,
        flags=re.IGNORECASE,
    )
    # Remove referência à tabela virtual blocos_fts nos JOINs
    adapted = re.sub(
        r"FROM\s+blocos_fts\s*\n\s*JOIN\s+blocos\s+b\s+ON\s+blocos_fts\.rowid\s*=\s*b\.id",
        "FROM blocos b",
        adapted,
        flags=re.IGNORECASE,
    )

    return adapted


# ── CRUD genérico (mesma interface do backend SQLite) ─────────────────────────

def fetchall(conn, sql: str, params: tuple = ()) -> list:
    """Executa SELECT e retorna lista de RealDictRow (acesso por row['col'])."""
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(_adapt_sql(sql), params)
            return cur.fetchall()
    except Exception:
        conn.rollback()
        raise


def fetchone(conn, sql: str, params: tuple = ()):
    """Executa SELECT e retorna um único RealDictRow ou None."""
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(_adapt_sql(sql), params)
            return cur.fetchone()
    except Exception:
        conn.rollback()
        raise


def execute(conn, sql: str, params: tuple = ()) -> int:
    """
    Executa INSERT/UPDATE/DELETE com commit automático.
    Para INSERT: adiciona RETURNING id e retorna o ID gerado.
    Para UPDATE/DELETE: retorna rowcount.
    """
    adapted = _adapt_sql(sql)
    is_insert = adapted.strip().upper().startswith("INSERT")

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if is_insert:
                # Adiciona RETURNING id para capturar o ID gerado
                adapted_ret = re.sub(r";?\s*$", " RETURNING id", adapted.rstrip())
                cur.execute(adapted_ret, params)
                conn.commit()
                row = cur.fetchone()
                return row["id"] if row else 0
            else:
                cur.execute(adapted, params)
                conn.commit()
                return cur.rowcount
    except Exception:
        conn.rollback()
        raise


def executemany(conn, sql: str, params_list: list) -> None:
    """Executa batch de INSERT/UPDATE/DELETE com commit único."""
    adapted = _adapt_sql(sql)
    try:
        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(cur, adapted, params_list)
        conn.commit()
    except Exception:
        conn.rollback()
        raise


# ── Health check ──────────────────────────────────────────────────────────────

def ping(conn) -> bool:
    """Verifica se a conexão ainda está ativa. Reconecta se necessário."""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        return True
    except Exception:
        return False
