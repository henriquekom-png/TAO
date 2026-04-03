"""
database/db_connection.py
Roteador de banco de dados — Sprint 8A.

Delega para o backend ativo (SQLite local ou Supabase) de forma
transparente. Todo o resto da aplicação continua usando:

    from database.db_connection import get_connection, fetchall, fetchone, execute

sem saber qual banco está ativo.

CHAVE SELETORA (Sprint 8B):
    O modo é controlado por st.session_state["db_mode"]:
      "sqlite"   → database/db_connection_sqlite.py  (local)
      "supabase" → database/db_connection_supabase.py (nuvem)

EMERGÊNCIA — como voltar 100% para SQLite sem alterar nada:
    Basta definir DB_MODE_DEFAULT = "sqlite" abaixo (já é o padrão).
    O Supabase nunca será tocado enquanto o modo for "sqlite".
"""

import sqlite3
import streamlit as st


# ── Detecção automática do ambiente ───────────────────────────────────────────
def _detect_default_mode() -> str:
    """
    Retorna "supabase" se SUPABASE_DB_URL estiver configurado nos secrets
    (indica que o app está rodando no Streamlit Cloud ou com Supabase ativo).
    Caso contrário, retorna "sqlite" (uso local).
    """
    try:
        url = st.secrets.get("SUPABASE_DB_URL", "")
        if url:
            return "supabase"
    except Exception:
        pass
    return "sqlite"


DB_MODE_DEFAULT = _detect_default_mode()


# ── Lazy imports dos backends ─────────────────────────────────────────────────

def _sqlite():
    from database import db_connection_sqlite as _m
    return _m


def _supabase():
    from database import db_connection_supabase as _m
    return _m


def _backend():
    """Retorna o módulo do backend ativo conforme st.session_state["db_mode"]."""
    if "db_mode" not in st.session_state:
        st.session_state["db_mode"] = DB_MODE_DEFAULT
    return _supabase() if st.session_state["db_mode"] == "supabase" else _sqlite()


# ── API pública (idêntica à do db_connection_sqlite.py original) ──────────────

def get_connection():
    """Retorna a conexão do backend ativo (SQLite ou Supabase)."""
    return _backend().get_connection()


def _is_supabase(conn) -> bool:
    """Detecta o backend pelo tipo do objeto de conexão."""
    return not isinstance(conn, sqlite3.Connection)


def fetchall(conn, sql: str, params: tuple = ()) -> list:
    """SELECT → lista de rows (acesso por row['coluna'] em ambos os backends)."""
    if _is_supabase(conn):
        return _supabase().fetchall(conn, sql, params)
    return _sqlite().fetchall(conn, sql, params)


def fetchone(conn, sql: str, params: tuple = ()):
    """SELECT → row único ou None."""
    if _is_supabase(conn):
        return _supabase().fetchone(conn, sql, params)
    return _sqlite().fetchone(conn, sql, params)


def execute(conn, sql: str, params: tuple = ()) -> int:
    """INSERT/UPDATE/DELETE → lastrowid (INSERT) ou rowcount."""
    if _is_supabase(conn):
        return _supabase().execute(conn, sql, params)
    return _sqlite().execute(conn, sql, params)


def executemany(conn, sql: str, params_list: list) -> None:
    """Batch INSERT/UPDATE/DELETE."""
    if _is_supabase(conn):
        return _supabase().executemany(conn, sql, params_list)
    return _sqlite().executemany(conn, sql, params_list)
