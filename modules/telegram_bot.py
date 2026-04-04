"""
modules/telegram_bot.py
Fast Entry via Telegram → anotações no bloco "Capturas do Telegram".

- Só grava no PostgreSQL (Supabase), com conexão própria por operação.
- Arranque em thread + singleton por processo (evita polling duplicado em reruns).
- Requer nos Secrets: TELEGRAM_BOT_TOKEN, MY_TELEGRAM_USER_ID, SUPABASE_DB_URL.

Em ambientes com várias réplicas (ex.: Streamlit Cloud), não use o mesmo token
em polling simultâneo — um único processo deve consumir getUpdates.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

import psycopg2
from telegram import Update
from telegram.ext import Application, ContextTypes, MessageHandler, filters

_logger = logging.getLogger(__name__)

PASTA_NOME = "Rascunhos"
DOC_TITULO = "Entrada Rápida"
CAPTURE_IDENT = "Capturas do Telegram"

_singleton_lock = threading.Lock()
_bot_started = False
_logged_singleton_skip = False
_logged_maybe_start_once = False
_logged_secrets_snapshot_once = False


def _read_secret(st_secrets: Any, key: str) -> str:
    """
    Lê um secret de forma compatível com o objeto `st.secrets` do Streamlit.
    Usa [] em primeiro lugar porque `.get()` por vezes não devolve chaves válidas
    no TOML (conforme versão / tipo do mapping).
    """
    try:
        v = st_secrets[key]
        if v is not None and str(v).strip():
            return str(v).strip()
    except (KeyError, TypeError):
        pass
    try:
        if hasattr(st_secrets, "get"):
            v = st_secrets.get(key)
            if v is not None and str(v).strip():
                return str(v).strip()
    except Exception:
        pass
    # Opcional: chaves sob [telegram] no TOML
    try:
        sec = st_secrets["telegram"]
        if isinstance(sec, dict):
            v = sec.get(key)
            if v is not None and str(v).strip():
                return str(v).strip()
    except (KeyError, TypeError):
        pass
    return ""


def _ensure_db_url(db_url: str) -> str:
    if "sslmode=" not in db_url:
        sep = "&" if "?" in db_url else "?"
        return f"{db_url}{sep}sslmode=require"
    return db_url


def _save_capture(db_url: str, text: str) -> None:
    """Resolve pasta → documento → bloco; insere anotação (transação única)."""
    text = (text or "").strip()
    if not text:
        raise ValueError("Mensagem vazia.")

    conn = psycopg2.connect(_ensure_db_url(db_url))
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM pastas WHERE nome = %s ORDER BY id LIMIT 1",
                (PASTA_NOME,),
            )
            row = cur.fetchone()
            if not row:
                raise RuntimeError(
                    f"Pasta '{PASTA_NOME}' não encontrada no Supabase. "
                    "Crie-a na app ou execute o schema."
                )
            pasta_id = row[0]

            cur.execute(
                "SELECT id FROM documentos WHERE pasta_id = %s AND titulo = %s LIMIT 1",
                (pasta_id, DOC_TITULO),
            )
            doc_row = cur.fetchone()
            if doc_row:
                doc_id = doc_row[0]
            else:
                cur.execute(
                    "INSERT INTO documentos (pasta_id, titulo) VALUES (%s, %s) RETURNING id",
                    (pasta_id, DOC_TITULO),
                )
                doc_id = cur.fetchone()[0]

            cur.execute(
                """
                SELECT id FROM blocos
                WHERE documento_id = %s AND tipo = 'texto_livre' AND identificador = %s
                LIMIT 1
                """,
                (doc_id, CAPTURE_IDENT),
            )
            bl_row = cur.fetchone()
            if bl_row:
                bloco_id = bl_row[0]
            else:
                cur.execute(
                    "SELECT COALESCE(MAX(ordem), -1) + 1 FROM blocos WHERE documento_id = %s",
                    (doc_id,),
                )
                next_b_ord = cur.fetchone()[0]
                cur.execute(
                    """
                    INSERT INTO blocos (documento_id, tipo, identificador, conteudo, ordem)
                    VALUES (%s, 'texto_livre', %s, '', %s)
                    RETURNING id
                    """,
                    (doc_id, CAPTURE_IDENT, next_b_ord),
                )
                bloco_id = cur.fetchone()[0]

            cur.execute(
                "SELECT COALESCE(MAX(ordem), -1) + 1 FROM anotacoes WHERE bloco_id = %s",
                (bloco_id,),
            )
            next_a_ord = cur.fetchone()[0]
            cur.execute(
                """
                INSERT INTO anotacoes (bloco_id, tipo, conteudo, ordem)
                VALUES (%s, 'texto', %s, %s)
                """,
                (bloco_id, text, next_a_ord),
            )

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _build_handlers(allowed_user_id: int, db_url: str) -> list[Any]:
    async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        print("[TAO Telegram] Bot recebeu mensagem! (handler de texto invocado)", flush=True)
        if not update.message or not update.effective_user:
            print("[TAO Telegram] Sem message ou user — a sair.", flush=True)
            return
        uid = update.effective_user.id
        print(f"[TAO Telegram] user_id do remetente: {uid} (esperado: {allowed_user_id})", flush=True)
        if uid != allowed_user_id:
            print(
                "[TAO Telegram] Ignorado: user_id não coincide com MY_TELEGRAM_USER_ID.",
                flush=True,
            )
            _logger.warning("Ignorada mensagem de user_id=%s", uid)
            return
        raw = update.message.text
        if raw is None:
            print("[TAO Telegram] Mensagem sem texto (ex.: só mídia).", flush=True)
            return
        try:
            await asyncio.to_thread(_save_capture, db_url, raw)
            await update.message.reply_text("Guardado no TAO (Entrada Rápida).")
        except Exception as exc:
            _logger.exception("Falha ao gravar captura Telegram")
            await update.message.reply_text(f"Erro ao guardar: {exc}")

    return [MessageHandler(filters.TEXT & ~filters.COMMAND, on_text)]


def _run_polling_blocking(token: str, allowed_user_id: int, db_url: str) -> None:
    logging.basicConfig(
        format="%(asctime)s %(levelname)s [telegram_bot] %(message)s",
        level=logging.INFO,
    )
    app = (
        Application.builder()
        .token(token)
        .build()
    )
    for h in _build_handlers(allowed_user_id, db_url):
        app.add_handler(h)

    _logger.info("Telegram Fast Entry: polling iniciado (user_id=%s).", allowed_user_id)
    print(
        f"[TAO Telegram] run_polling a iniciar (user_id permitido={allowed_user_id})…",
        flush=True,
    )
    try:
        app.run_polling(drop_pending_updates=True)
    except Exception:
        print("[TAO Telegram] ERRO em run_polling (ver traceback abaixo):", flush=True)
        raise


def maybe_start_background(st_secrets: Any) -> None:
    """
    Inicia o bot uma vez por processo, se os secrets necessários existirem.
    `st_secrets` deve ser `st.secrets` (lido na thread principal do Streamlit).
    """
    global _bot_started, _logged_singleton_skip, _logged_maybe_start_once, _logged_secrets_snapshot_once

    if not _logged_maybe_start_once:
        print("[TAO Telegram] maybe_start_background() chamado (1.ª vez neste processo).", flush=True)
        _logged_maybe_start_once = True
    try:
        token = _read_secret(st_secrets, "TELEGRAM_BOT_TOKEN")
        raw_uid = _read_secret(st_secrets, "MY_TELEGRAM_USER_ID")
        db_url = _read_secret(st_secrets, "SUPABASE_DB_URL")
    except Exception as exc:
        print(f"[TAO Telegram] Erro ao ler st.secrets: {exc!r}", flush=True)
        return

    has_tok = bool(token)
    has_uid = bool(raw_uid)
    has_db = bool(db_url)
    if not _logged_secrets_snapshot_once:
        print(
            f"[TAO Telegram] Secrets: token={'sim' if has_tok else 'NÃO'}, "
            f"user_id={'sim' if has_uid else 'NÃO'}, supabase_url={'sim' if has_db else 'NÃO'}",
            flush=True,
        )
        try:
            keys = list(st_secrets.keys()) if hasattr(st_secrets, "keys") else []
            print(f"[TAO Telegram] Chaves visíveis em st.secrets: {keys}", flush=True)
        except Exception as exc:
            print(f"[TAO Telegram] Não foi possível listar chaves: {exc!r}", flush=True)
        _logged_secrets_snapshot_once = True
    if not (has_tok and has_uid and has_db):
        print(
            "[TAO Telegram] SKIP: faltam TELEGRAM_BOT_TOKEN, MY_TELEGRAM_USER_ID "
            "ou SUPABASE_DB_URL (verifique nomes no secrets.toml e reinicie o Streamlit).",
            flush=True,
        )
        return

    try:
        allowed_user_id = int(raw_uid)
    except (TypeError, ValueError):
        print(f"[TAO Telegram] SKIP: MY_TELEGRAM_USER_ID inválido: {raw_uid!r}", flush=True)
        _logger.warning("MY_TELEGRAM_USER_ID inválido; bot não iniciado.")
        return

    with _singleton_lock:
        if _bot_started:
            if not _logged_singleton_skip:
                print(
                    "[TAO Telegram] SKIP: bot já iniciado neste processo (singleton).",
                    flush=True,
                )
                _logged_singleton_skip = True
            return
        _bot_started = True

    print("[TAO Telegram] A lançar thread do bot…", flush=True)
    t = threading.Thread(
        target=_run_polling_blocking,
        args=(token, allowed_user_id, db_url),
        name="tao-telegram-bot",
        daemon=True,
    )
    t.start()
