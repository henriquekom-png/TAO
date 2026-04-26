"""
Busca full-text (PostgreSQL / Supabase) em pastas, documentos, blocos e anotações.
- Só leitura; disponível apenas com ligação à nuvem.
- Ordem de precedência na lista final: bloco > anotação > documento > pasta (até 8 itens),
  com deduplicação por alvo lógico (bloco, documento, pasta).
"""

from __future__ import annotations

import re
import sqlite3
import streamlit as st
from database.db_connection import fetchall, fetchone


def _is_supabase_conn(conn) -> bool:
    return not isinstance(conn, sqlite3.Connection)


def _snippet(text: str | None, max_len: int = 220) -> str:
    if not text or not str(text).strip():
        return "—"
    s = re.sub(r"\s+", " ", str(text).strip())
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def _ancestors_chain_ids(conn, pasta_id: int) -> list[int]:
    """Cadeia pasta_id → raiz (ids na ordem filho → ancestral)."""
    chain: list[int] = []
    cur = pasta_id
    for _ in range(200):
        if cur is None:
            break
        chain.append(cur)
        row = fetchone(conn, "SELECT parent_id FROM pastas WHERE id = ?", (cur,))
        if not row or row.get("parent_id") is None:
            break
        cur = row["parent_id"]
    return chain


def ensure_sidebar_expanded_to_pasta(conn, pasta_id: int | None) -> None:
    """Garante pastas abertas na sidebar até enquadrar a pasta dada."""
    if pasta_id is None:
        return
    if not _is_supabase_conn(conn):
        return
    for pid in _ancestors_chain_ids(conn, pasta_id):
        st.session_state[f"expanded_{pid}"] = True


def _run_fts_blocos(conn, q: str) -> list[dict]:
    return fetchall(
        conn,
        """
        SELECT
            b.id AS bloco_id,
            b.conteudo,
            b.identificador,
            b.documento_id,
            d.titulo AS doc_titulo,
            d.pasta_id,
            p.nome AS pasta_nome,
            ts_rank_cd(b.fts_vector, plainto_tsquery('portuguese', ?)) AS rnk
        FROM blocos b
        JOIN documentos d ON d.id = b.documento_id
        JOIN pastas p ON p.id = d.pasta_id
        WHERE b.fts_vector @@ plainto_tsquery('portuguese', ?)
        ORDER BY rnk DESC NULLS LAST
        LIMIT 16
        """,
        (q, q),
    )


def _run_fts_anotacoes(conn, q: str) -> list[dict]:
    return fetchall(
        conn,
        """
        SELECT
            a.id AS anot_id,
            a.bloco_id,
            a.conteudo,
            b.documento_id,
            d.titulo AS doc_titulo,
            d.pasta_id,
            p.nome AS pasta_nome,
            ts_rank_cd(
                to_tsvector('portuguese', a.conteudo),
                plainto_tsquery('portuguese', ?)
            ) AS rnk
        FROM anotacoes a
        JOIN blocos b ON b.id = a.bloco_id
        JOIN documentos d ON d.id = b.documento_id
        JOIN pastas p ON p.id = d.pasta_id
        WHERE to_tsvector('portuguese', a.conteudo)
              @@ plainto_tsquery('portuguese', ?)
        ORDER BY rnk DESC NULLS LAST
        LIMIT 16
        """,
        (q, q),
    )


def _run_fts_documentos(conn, q: str) -> list[dict]:
    return fetchall(
        conn,
        """
        SELECT
            d.id AS documento_id,
            d.titulo,
            d.pasta_id,
            p.nome AS pasta_nome,
            ts_rank_cd(
                to_tsvector('portuguese', d.titulo),
                plainto_tsquery('portuguese', ?)
            ) AS rnk
        FROM documentos d
        JOIN pastas p ON p.id = d.pasta_id
        WHERE to_tsvector('portuguese', d.titulo)
              @@ plainto_tsquery('portuguese', ?)
        ORDER BY rnk DESC NULLS LAST
        LIMIT 16
        """,
        (q, q),
    )


def _run_fts_pastas(conn, q: str) -> list[dict]:
    return fetchall(
        conn,
        """
        SELECT
            p.id AS pasta_id,
            p.nome,
            ts_rank_cd(
                to_tsvector('portuguese', p.nome),
                plainto_tsquery('portuguese', ?)
            ) AS rnk
        FROM pastas p
        WHERE to_tsvector('portuguese', p.nome)
              @@ plainto_tsquery('portuguese', ?)
        ORDER BY rnk DESC NULLS LAST
        LIMIT 16
        """,
        (q, q),
    )


def _merge_hits(
    blocos: list, anots: list, docs: list, pastas: list, limit: int = 8
) -> list[dict]:
    out: list[dict] = []
    seen_bloco: set[int] = set()
    seen_doc: set[int] = set()
    seen_pasta: set[int] = set()

    for row in blocos:
        if len(out) >= limit:
            break
        bid = row["bloco_id"]
        if bid in seen_bloco:
            continue
        seen_bloco.add(bid)
        d_id = row["documento_id"]
        p_id = row["pasta_id"]
        seen_doc.add(d_id)
        seen_pasta.add(p_id)
        out.append(
            {
                "tipo": "bloco",
                "bloco_id": bid,
                "documento_id": d_id,
                "pasta_id": p_id,
                "titulo_ui": f"📄 {row.get('doc_titulo', '')} — {row.get('identificador') or 'Bloco'}",
                "sub": f"📁 {row.get('pasta_nome', '')}",
                "detalhe": _snippet(row.get("conteudo")),
            }
        )

    for row in anots:
        if len(out) >= limit:
            break
        bid = row["bloco_id"]
        if bid in seen_bloco:
            continue
        seen_bloco.add(bid)
        d_id = row["documento_id"]
        p_id = row["pasta_id"]
        seen_doc.add(d_id)
        seen_pasta.add(p_id)
        out.append(
            {
                "tipo": "anotacao",
                "bloco_id": bid,
                "documento_id": d_id,
                "pasta_id": p_id,
                "anot_id": row["anot_id"],
                "titulo_ui": f"📝 Anotação — {row.get('doc_titulo', '')}",
                "sub": f"📁 {row.get('pasta_nome', '')}",
                "detalhe": _snippet(row.get("conteudo")),
            }
        )

    for row in docs:
        if len(out) >= limit:
            break
        d_id = row["documento_id"]
        if d_id in seen_doc:
            continue
        seen_doc.add(d_id)
        p_id = row["pasta_id"]
        seen_pasta.add(p_id)
        out.append(
            {
                "tipo": "documento",
                "documento_id": d_id,
                "pasta_id": p_id,
                "titulo_ui": f"📃 {row.get('titulo', '')}",
                "sub": f"📁 {row.get('pasta_nome', '')}",
                "detalhe": _snippet(row.get("titulo"), 300),
            }
        )

    for row in pastas:
        if len(out) >= limit:
            break
        p_id = row["pasta_id"]
        if p_id in seen_pasta:
            continue
        seen_pasta.add(p_id)
        out.append(
            {
                "tipo": "pasta",
                "pasta_id": p_id,
                "titulo_ui": f"📂 {row.get('nome', '')}",
                "sub": "Pasta",
                "detalhe": f"{row.get('nome', '')}",
            }
        )

    return out


def buscar_fts_combinado(conn, query: str) -> list[dict]:
    """
    Até 8 resultados; precedência bloco > anotação > documento > pasta, com deduplicação.
    Retorna lista vazia fora do Supabase ou com query vazia / erro.
    """
    if not _is_supabase_conn(conn):
        return []
    q = (query or "").strip()
    if len(q) < 2:
        return []
    try:
        blocos = _run_fts_blocos(conn, q)
        anots = _run_fts_anotacoes(conn, q)
        docs = _run_fts_documentos(conn, q)
        pasts = _run_fts_pastas(conn, q)
        return _merge_hits(blocos, anots, docs, pasts, 8)
    except Exception:
        return []


def aplicar_navegacao_por_hito(h: dict, conn) -> None:
    """Define session_state e expande a sidebar. Esconde o painel de busca."""
    st.session_state["app_mode"] = "documentos"
    st.session_state["show_chatbot"] = False
    st.session_state["tao_search_expanded"] = False
    st.session_state["tao_search_hits"] = []
    t = h.get("tipo")

    if t in ("bloco", "anotacao"):
        d_id = h["documento_id"]
        b_id = h["bloco_id"]
        row = fetchone(
            conn,
            "SELECT titulo FROM documentos WHERE id = ?",
            (d_id,),
        )
        tit = (row or {}).get("titulo") or ""
        st.session_state["active_document_id"] = d_id
        st.session_state["active_document_titulo"] = tit
        st.session_state["active_bloco_id"] = b_id
        st.session_state["editing_id"] = None
        ensure_sidebar_expanded_to_pasta(conn, h.get("pasta_id"))

    elif t == "documento":
        d_id = h["documento_id"]
        row = fetchone(
            conn,
            "SELECT titulo FROM documentos WHERE id = ?",
            (d_id,),
        )
        tit = (row or {}).get("titulo") or ""
        st.session_state["active_document_id"] = d_id
        st.session_state["active_document_titulo"] = tit
        st.session_state["active_bloco_id"] = None
        st.session_state["editing_id"] = None
        ensure_sidebar_expanded_to_pasta(conn, h.get("pasta_id"))

    else:  # pasta
        pid = h["pasta_id"]
        st.session_state["active_bloco_id"] = None
        ensure_sidebar_expanded_to_pasta(conn, pid)
        first = fetchone(
            conn,
            "SELECT id, titulo FROM documentos WHERE pasta_id = ? "
            "ORDER BY ordem, LOWER(titulo) LIMIT 1",
            (pid,),
        )
        if first:
            st.session_state["active_document_id"] = first["id"]
            st.session_state["active_document_titulo"] = first["titulo"] or ""
        else:
            st.session_state["active_document_id"] = None
            st.session_state["active_document_titulo"] = None
        st.session_state["editing_id"] = None


def render_search_sidebar_block(conn) -> None:
    """UI na barra lateral: busca (só nuvem)."""
    is_cloud = st.session_state.get("db_mode") == "supabase"
    st.markdown("##### 🔍 Busca")
    if not is_cloud:
        st.caption("Disponível no modo **🌐 Nuvem** (FTS no PostgreSQL).")
        st.session_state.pop("tao_search_hits", None)
        return

    if "tao_search_expanded" not in st.session_state:
        st.session_state["tao_search_expanded"] = True

    qkey = "tao_search_input_field"
    if qkey not in st.session_state:
        st.session_state[qkey] = ""

    q = st.text_input(
        "Termo (português)",
        key=qkey,
        placeholder="Mín. 2 caracteres…",
        label_visibility="collapsed",
    )
    if st.button("Buscar", key="tao_search_btn", use_container_width=True):
        st.session_state["tao_search_hits"] = buscar_fts_combinado(conn, q)
        st.session_state["tao_search_expanded"] = True
        st.rerun()

    hits: list[dict] = st.session_state.get("tao_search_hits") or []
    if not hits:
        return

    with st.expander(
        f"Resultados ({len(hits)} / 8 max)",
        expanded=st.session_state.get("tao_search_expanded", True),
    ):
        for i, h in enumerate(hits):
            st.caption(h.get("sub", ""))
            st.markdown(
                f"<p style='font-size:0.9rem;font-weight:600'>{h.get('titulo_ui', '')}</p>",
                unsafe_allow_html=True,
            )
            st.caption(h.get("detalhe", ""))
            if st.button(
                "Abrir",
                key=f"tao_open_hit_{i}_{h.get('tipo')}",
                use_container_width=True,
            ):
                aplicar_navegacao_por_hito(h, conn)
                st.rerun()
            st.divider()

        if st.button("Fechar resultados", key="tao_search_close", use_container_width=True):
            st.session_state["tao_search_hits"] = []
            st.session_state["tao_search_expanded"] = False
            st.rerun()
