"""
database/backup.py
Sprint 8B — Backup e sincronização entre SQLite local e Supabase.

Funções principais:
  download_cloud_to_local()  — Supabase → tao.db  (cópia de segurança)
  sync_local_to_cloud()      — tao.db → Supabase  (upload offline)

Ambas usam transação atômica: se algo falhar no meio do processo,
o banco de destino NÃO é corrompido (rollback automático).
"""

import io
import sqlite3
from datetime import date
from pathlib import Path

import streamlit as st

from database.db_connection_supabase import repair_identity_sequences

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH  = BASE_DIR / "database" / "tao.db"

# Tabelas sincronizadas (ordem respeita foreign keys)
_TABLES = ["pastas", "documentos", "blocos", "anotacoes", "portais", "materiais",
           "questoes", "questao_itens", "quiz_resultados"]

# Colunas que o PostgreSQL gera automaticamente (não inserir via SQL)
_GENERATED = {"fts_vector"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pg_conn():
    """Abre conexão psycopg2 ao Supabase."""
    import psycopg2
    db_url = st.secrets["SUPABASE_DB_URL"]
    conn = psycopg2.connect(db_url, sslmode="require")
    return conn


def _sqlite_conn():
    """Abre conexão SQLite local (independente do cache do Streamlit)."""
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=OFF")   # desativa FK durante bulk insert
    return conn


def _col_names(pg_cur, table: str) -> list[str]:
    """Retorna nomes das colunas de uma tabela PostgreSQL, excluindo geradas."""
    pg_cur.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_name = %s AND table_schema = 'public'
        ORDER BY ordinal_position
        """,
        (table,),
    )
    return [r[0] for r in pg_cur.fetchall() if r[0] not in _GENERATED]


# ── Download: Supabase → SQLite local ────────────────────────────────────────

def download_cloud_to_local() -> dict:
    """
    Copia todos os dados do Supabase para o tao.db local.
    Usa transação atômica: rollback se qualquer erro ocorrer.
    Retorna dict com contagem de registros por tabela.
    """
    pg   = _pg_conn()
    
    # Recria o banco local a partir do schema e migrações para garantir integridade estrutural
    if DB_PATH.exists():
        try:
            DB_PATH.unlink()
        except Exception:
            pass

    lite = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    from database import db_connection_sqlite
    db_connection_sqlite._apply_schema(lite)
    db_connection_sqlite._run_migrations(lite)
    
    lite.row_factory = sqlite3.Row
    lite.execute("PRAGMA foreign_keys=OFF")
    counts = {}

    try:
        pg_cur = pg.cursor()
        lite.execute("BEGIN")

        for table in _TABLES:
            cols = _col_names(pg_cur, table)
            
            # Filtrar colunas que existem no SQLite local para evitar erros de compatibilidade
            lite_cols_info = lite.execute(f"PRAGMA table_info({table})").fetchall()
            lite_cols = {c[1] for c in lite_cols_info}
            cols = [c for c in cols if c in lite_cols]
            
            cols_sql = ", ".join(cols)
            placeholders = ", ".join(["?"] * len(cols))

            # Lê dados da nuvem
            pg_cur.execute(f"SELECT {cols_sql} FROM {table} ORDER BY id")
            rows = pg_cur.fetchall()

            # Limpa tabela local e reinsere
            lite.execute(f"DELETE FROM {table}")
            if rows:
                lite.executemany(
                    f"INSERT OR REPLACE INTO {table} ({cols_sql}) VALUES ({placeholders})",
                    rows,
                )
            counts[table] = len(rows)

        lite.execute("COMMIT")

    except Exception as exc:
        lite.execute("ROLLBACK")
        pg.close()
        lite.close()
        raise RuntimeError(f"Download falhou — banco local preservado.\nDetalhe: {exc}")

    finally:
        try:
            lite.execute("PRAGMA foreign_keys=ON")
        except Exception:
            pass
        pg.close()
        lite.close()

    return counts


# ── Upload: SQLite local → Supabase ──────────────────────────────────────────

def _bool_cols(pg_cur, table: str) -> set[str]:
    """Retorna o conjunto de colunas boolean de uma tabela no PostgreSQL."""
    pg_cur.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_name = %s
          AND table_schema = 'public'
          AND data_type = 'boolean'
        """,
        (table,),
    )
    return {r[0] for r in pg_cur.fetchall()}


def _convert_row(row, cols: list[str], bool_set: set[str]) -> tuple:
    """Converte valores inteiros 0/1 para bool onde o PostgreSQL espera boolean."""
    result = []
    for col, val in zip(cols, row):
        if col in bool_set and isinstance(val, int):
            result.append(bool(val))
        else:
            result.append(val)
    return tuple(result)


def sync_local_to_cloud() -> dict:
    """
    Envia dados do tao.db local para o Supabase (upsert).
    Converte colunas boolean de int (SQLite) para bool (PostgreSQL).
    Usa transação atômica: rollback se qualquer erro ocorrer.
    Retorna dict com contagem de registros por tabela.
    """
    import psycopg2.extras

    pg   = _pg_conn()
    lite = _sqlite_conn()
    counts = {}

    try:
        pg_cur        = pg.cursor()
        pg.autocommit = False

        for table in _TABLES:
            cols      = _col_names(pg_cur, table)
            bools     = _bool_cols(pg_cur, table)
            cols_sql  = ", ".join(cols)
            ph        = ", ".join(["%s"] * len(cols))
            update    = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != "id")

            rows = lite.execute(
                f"SELECT {cols_sql} FROM {table} ORDER BY id"
            ).fetchall()

            if rows:
                upsert_sql = (
                    f"INSERT INTO {table} ({cols_sql}) "
                    f"OVERRIDING SYSTEM VALUE "
                    f"VALUES ({ph}) "
                    f"ON CONFLICT (id) DO UPDATE SET {update}"
                )
                converted = [_convert_row(r, cols, bools) for r in rows]
                psycopg2.extras.execute_batch(pg_cur, upsert_sql, converted)

            counts[table] = len(rows)

        # INSERT OVERRIDING SYSTEM VALUE não avança sequências IDENTITY — evita UniqueViolation
        repair_identity_sequences(pg, do_commit=False)
        pg.commit()

    except Exception as exc:
        pg.rollback()
        pg.close()
        lite.close()
        raise RuntimeError(f"Upload falhou — Supabase preservado.\nDetalhe: {exc}")

    finally:
        pg.close()
        lite.close()

    return counts


# ── Snapshot: Supabase → arquivo .db para download ───────────────────────────

def generate_backup_db() -> tuple[bytes, str]:
    """
    Lê todos os dados do Supabase e gera um arquivo SQLite (.db) em memória.
    Retorna (bytes_do_arquivo, nome_do_arquivo).
    """
    pg      = _pg_conn()
    pg_cur  = pg.cursor()

    mem_conn = sqlite3.connect(":memory:", check_same_thread=False)
    mem_conn.execute("PRAGMA foreign_keys=OFF")

    schema_path = BASE_DIR / "database" / "schema.sql"
    if schema_path.exists():
        mem_conn.executescript(schema_path.read_text(encoding="utf-8"))

    try:
        mem_conn.execute("BEGIN")

        for table in _TABLES:
            pg_cur.execute(
                "SELECT EXISTS(SELECT 1 FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name=%s)",
                (table,),
            )
            if not pg_cur.fetchone()[0]:
                continue

            cols = _col_names(pg_cur, table)
            mem_col_names = {
                row[1] for row in
                mem_conn.execute(f"PRAGMA table_info({table})").fetchall()
            }
            cols = [c for c in cols if c in mem_col_names]
            if not cols:
                continue

            cols_sql     = ", ".join(cols)
            placeholders = ", ".join(["?"] * len(cols))

            pg_cur.execute(f"SELECT {cols_sql} FROM {table} ORDER BY id")
            rows = pg_cur.fetchall()
            if rows:
                mem_conn.executemany(
                    f"INSERT OR REPLACE INTO {table} ({cols_sql}) "
                    f"VALUES ({placeholders})",
                    rows,
                )

        mem_conn.execute("COMMIT")

    except Exception as exc:
        mem_conn.execute("ROLLBACK")
        pg.close()
        mem_conn.close()
        raise RuntimeError(f"Erro ao gerar backup: {exc}")
    finally:
        pg.close()

    # Serializa para bytes via arquivo temporário
    tmp_path = BASE_DIR / "database" / "_backup_tmp.db"
    try:
        disk_conn = sqlite3.connect(str(tmp_path))
        mem_conn.backup(disk_conn)
        disk_conn.close()
        data = tmp_path.read_bytes()
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass

    mem_conn.close()
    return data, f"TAO_backup_{date.today()}.db"
