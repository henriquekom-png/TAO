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

    conn = psycopg2.connect(db_url, sslmode="require")
    conn.autocommit = False
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
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(_adapt_sql(sql), params)
        return cur.fetchall()


def fetchone(conn, sql: str, params: tuple = ()):
    """Executa SELECT e retorna um único RealDictRow ou None."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(_adapt_sql(sql), params)
        return cur.fetchone()


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
