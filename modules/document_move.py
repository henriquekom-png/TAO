"""
modules/document_move.py
Mover documento para outra pasta — destinos com caminho hierárquico.
Regra: documentos não podem ficar com pasta_id na raiz (parent_id IS NULL).
"""

import html

import streamlit as st

from database.db_connection import fetchall, fetchone, execute

_PATH_SEP = " › "


def _lista_destinos_com_caminho(conn) -> list[tuple[int, str]]:
    rows = fetchall(
        conn,
        "SELECT id, parent_id, nome FROM pastas ORDER BY nivel, ordem, LOWER(nome)",
        (),
    )
    if not rows:
        return []

    id_to = {r["id"]: r for r in rows}
    root_ids = {r["id"] for r in rows if r["parent_id"] is None}

    def caminho(pid: int) -> str:
        partes: list[str] = []
        visitados: set[int] = set()
        cur = id_to.get(pid)
        while cur is not None and cur["id"] not in visitados:
            visitados.add(cur["id"])
            partes.append((cur["nome"] or "").strip())
            p = cur["parent_id"]
            cur = id_to.get(p) if p is not None else None
        return _PATH_SEP.join(reversed(partes))

    out: list[tuple[int, str]] = []
    for r in rows:
        pid = r["id"]
        if pid in root_ids:
            continue
        out.append((pid, caminho(pid)))
    out.sort(key=lambda x: x[1].casefold())
    return out


def render_document_move_popover(conn, documento_id: int) -> None:
    """Popover 📦 Mover: selectbox por caminho + confirmar UPDATE."""
    doc = fetchone(
        conn,
        "SELECT id, titulo, pasta_id FROM documentos WHERE id = ?",
        (documento_id,),
    )
    if not doc:
        return

    pasta_atual = doc["pasta_id"]
    destinos = _lista_destinos_com_caminho(conn)
    if not destinos:
        with st.popover("📦", use_container_width=True, help="Mover para pasta…"):
            st.caption("Mover documento")
            st.warning("Não há pastas válidas (só existe a raiz ou nenhuma pasta).")
        return

    labels = [lbl for _, lbl in destinos]
    label_to_id = {lbl: pid for pid, lbl in destinos}

    with st.popover("📦", use_container_width=True, help="Mover para pasta…"):
        st.caption("Mover documento")
        titulo_safe = html.escape(str(doc["titulo"] or ""))
        st.markdown(
            f"<p style='font-size:0.82rem;color:#555;margin:0 0 0.5rem 0;'>"
            f"<strong>{titulo_safe}</strong></p>",
            unsafe_allow_html=True,
        )

        default_idx = 0
        if pasta_atual is not None:
            for i, (pid, _) in enumerate(destinos):
                if pid == pasta_atual:
                    default_idx = i
                    break

        escolha = st.selectbox(
            "Pasta de destino (caminho)",
            options=labels,
            index=default_idx,
            key=f"move_doc_sel_{documento_id}",
        )

        if st.button(
            "Confirmar mudança",
            key=f"move_doc_confirm_{documento_id}",
            use_container_width=True,
            type="primary",
        ):
            novo_pid = label_to_id[escolha]
            if novo_pid == pasta_atual:
                st.info("O documento já está nesta pasta.")
            else:
                execute(
                    conn,
                    "UPDATE documentos SET pasta_id = ? WHERE id = ?",
                    (novo_pid, documento_id),
                )
                st.success("Documento movido.")
                st.rerun()
