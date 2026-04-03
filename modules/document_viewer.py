"""
modules/document_viewer.py
Sprint 3 — Visualizador de Blocos Atômicos
- Modo Visualização / Modo Edição reativo por bloco
- Heatmap (Normal / Importante / Vital)
- FSRS: checkbox colorido com agendamento automático
- Parser de texto jurídico (artigos, parágrafos, incisos, alíneas)
"""

import re
import streamlit as st
from datetime import date, timedelta
from database.db_connection import fetchall, fetchone, execute
from modules.fsrs_manager import schedule_review, fsrs_dot, RATING_LABELS

# ── Mapeamento de importância → CSS ──────────────────────────────────────────
_IMPORTANCIA_CSS = {
    "normal":     "",
    "importante": "importante",
    "vital":      "vital",
}

# ── Undo stack ────────────────────────────────────────────────────────────────
_MAX_UNDO = 30

def _bloco_to_dict(row) -> dict:
    """Converte sqlite3.Row de bloco em dict serializável para o undo stack."""
    keys = ["id", "documento_id", "tipo", "identificador", "conteudo", "ordem",
            "importancia", "revisado", "last_review", "next_review",
            "stability", "difficulty", "reps"]
    d = {k: row[k] for k in keys}
    for k in ("cor_fonte", "alinhamento", "fsrs_state"):
        try:
            d[k] = row[k]
        except (IndexError, KeyError):
            pass
    return d

def _push_undo(action: str, data: dict) -> None:
    """Empilha uma operação desfeita no undo stack da sessão."""
    stack = st.session_state.setdefault("undo_stack", [])
    stack.append({"action": action, "data": data})
    if len(stack) > _MAX_UNDO:
        stack.pop(0)

def _undo_last(conn) -> str:
    """
    Desfaz a última operação do undo stack.
    Retorna descrição do que foi desfeito (ou string vazia se stack vazio).
    """
    stack = st.session_state.get("undo_stack", [])
    if not stack:
        return ""
    op     = stack.pop()
    action = op["action"]
    data   = op["data"]

    if action == "delete_blocos":
        for b in data["blocos"]:
            execute(
                conn,
                """INSERT OR IGNORE INTO blocos
                   (id, documento_id, tipo, identificador, conteudo, ordem,
                    importancia, revisado, last_review, next_review,
                    stability, difficulty, reps)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (b["id"], b["documento_id"], b["tipo"], b["identificador"],
                 b["conteudo"], b["ordem"], b["importancia"], b["revisado"],
                 b["last_review"], b["next_review"],
                 b["stability"], b["difficulty"], b["reps"]),
            )
        n = len(data["blocos"])
        return f"↩ {n} bloco(s) restaurado(s)"

    elif action == "edit_conteudo":
        execute(conn,
                "UPDATE blocos SET conteudo=? WHERE id=?",
                (data["conteudo_anterior"], data["id"]))
        return "↩ Edição desfeita"

    elif action == "edit_importancia":
        execute(conn,
                "UPDATE blocos SET importancia=? WHERE id=?",
                (data["importancia_anterior"], data["id"]))
        return "↩ Importância desfeita"

    return ""

# ── Regex para parser de texto jurídico ──────────────────────────────────────
_RE_ARTIGO    = re.compile(r'^(Art\.?\s*\d+[\-A-Za-z]*[\.º°]?)', re.IGNORECASE)
_RE_PARAGRAFO = re.compile(r'^(§\s*\d+[\.º°]?|Parágrafo\s+(?:único|\w+)\.?)', re.IGNORECASE)
_RE_INCISO    = re.compile(r'^([IVXLCDM]+\s*[-–—]|\d+\s*[-–—])')
_RE_ALINEA    = re.compile(r'^([a-z]\s*\))')

# ── Conversão Markdown → HTML inline ─────────────────────────────────────────
# Necessário porque o conteúdo é embutido dentro de tags HTML (<div>), onde
# st.markdown não processa Markdown — trata como HTML puro.
_RE_MD_BOLD_ITALIC = re.compile(r'\*{3}(.+?)\*{3}', re.DOTALL)
_RE_MD_BOLD        = re.compile(r'\*{2}(.+?)\*{2}', re.DOTALL)
_RE_MD_ITALIC      = re.compile(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', re.DOTALL)

def _md_to_html(text: str) -> str:
    """
    Converte formatação Markdown básica em HTML para uso dentro de tags HTML.
    Ordem: bold+italic → bold → italic (evita captura parcial de **)
    Tags <span style="color:..."> já são HTML e passam sem alteração.
    """
    if not text:
        return text
    text = _RE_MD_BOLD_ITALIC.sub(r'<strong><em>\1</em></strong>', text)
    text = _RE_MD_BOLD.sub(r'<strong>\1</strong>', text)
    text = _RE_MD_ITALIC.sub(r'<em>\1</em>', text)
    return text


# ── FSRS: funções auxiliares delegam a modules/fsrs_manager ──────────────────
# (fsrs_dot e schedule_review importados no topo)


# ── Parser ────────────────────────────────────────────────────────────────────

def _parse_texto(texto: str) -> list:
    """
    Fatia texto bruto em blocos atômicos.
    Detecta: artigos, parágrafos, incisos, alíneas, cabeçalhos e texto livre.
    """
    blocos: list[dict] = []
    buf_linhas: list[str] = []
    buf_tipo = "texto_livre"
    buf_id   = None

    def _flush():
        conteudo = " ".join(buf_linhas).strip()
        if conteudo:
            blocos.append({
                "tipo":         buf_tipo,
                "identificador": buf_id,
                "conteudo":     conteudo,
            })

    for raw in texto.splitlines():
        linha = raw.strip()
        if not linha:
            _flush()
            buf_linhas.clear()
            buf_tipo = "texto_livre"
            buf_id   = None
            continue

        m_art = _RE_ARTIGO.match(linha)
        m_par = _RE_PARAGRAFO.match(linha)
        m_inc = _RE_INCISO.match(linha)
        m_ali = _RE_ALINEA.match(linha)

        if m_art:
            _flush()
            buf_id   = m_art.group(1).strip()
            buf_tipo = "artigo"
            buf_linhas = [linha[len(m_art.group(1)):].strip()]
        elif m_par:
            _flush()
            buf_id   = m_par.group(1).strip()
            buf_tipo = "paragrafo"
            buf_linhas = [linha[len(m_par.group(1)):].strip()]
        elif m_inc:
            _flush()
            buf_id   = m_inc.group(1).strip()
            buf_tipo = "inciso"
            buf_linhas = [linha[len(m_inc.group(1)):].strip()]
        elif m_ali:
            _flush()
            buf_id   = m_ali.group(1).strip()
            buf_tipo = "alinea"
            buf_linhas = [linha[len(m_ali.group(1)):].strip()]
        else:
            # Continuação de bloco anterior ou novo texto livre
            if buf_linhas:
                buf_linhas.append(linha)
            else:
                buf_tipo = "texto_livre"; buf_id = None
                buf_linhas = [linha]

    _flush()
    return blocos


def _inserir_blocos(conn, documento_id: int, blocos: list) -> None:
    base_ordem = fetchall(
        conn,
        "SELECT COALESCE(MAX(ordem),0) AS m FROM blocos WHERE documento_id=?",
        (documento_id,)
    )[0]["m"]
    for i, b in enumerate(blocos, 1):
        execute(
            conn,
            "INSERT INTO blocos (documento_id,tipo,identificador,conteudo,ordem) VALUES(?,?,?,?,?)",
            (documento_id, b["tipo"], b.get("identificador"), b["conteudo"], base_ordem + i),
        )


# ── CRUD de blocos ────────────────────────────────────────────────────────────

def _get_blocos(conn, documento_id: int) -> list:
    return fetchall(
        conn,
        """SELECT id, tipo, identificador, conteudo, importancia,
                  revisado, last_review, next_review, stability, difficulty, reps,
                  cor_fonte, alinhamento,
                  COALESCE(fsrs_state, 0) AS fsrs_state
           FROM blocos WHERE documento_id=? ORDER BY ordem""",
        (documento_id,),
    )


def _salvar_estilo(conn, bloco_id: int, campo: str, valor: str) -> None:
    """Salva cor_fonte ou alinhamento de um bloco."""
    execute(conn, f"UPDATE blocos SET {campo}=? WHERE id=?", (valor, bloco_id))


def _salvar_conteudo(conn, bloco_id: int, novo: str, record_undo: bool = False) -> None:
    if record_undo:
        row = fetchone(conn, "SELECT conteudo FROM blocos WHERE id=?", (bloco_id,))
        if row:
            _push_undo("edit_conteudo", {"id": bloco_id, "conteudo_anterior": row["conteudo"]})
    execute(conn, "UPDATE blocos SET conteudo=? WHERE id=?", (novo.strip(), bloco_id))


def _salvar_importancia(conn, bloco_id: int, imp: str) -> None:
    row = fetchone(conn, "SELECT importancia FROM blocos WHERE id=?", (bloco_id,))
    if row:
        _push_undo("edit_importancia", {"id": bloco_id, "importancia_anterior": row["importancia"]})
    execute(conn, "UPDATE blocos SET importancia=? WHERE id=?", (imp, bloco_id))


def _marcar_revisao(conn, bloco_id: int, card_data: dict, rating_str: str = "good") -> None:
    """Aplica FSRS real e persiste o resultado no banco."""
    result = schedule_review(card_data, rating_str)
    execute(
        conn,
        """UPDATE blocos
           SET revisado=1, last_review=?, next_review=?,
               stability=?, difficulty=?, fsrs_state=?,
               reps=reps+1
           WHERE id=?""",
        (result["last_review"], result["next_review"],
         result["stability"], result["difficulty"], result["fsrs_state"],
         bloco_id),
    )


def _desmarcar_revisao(conn, bloco_id: int) -> None:
    execute(
        conn,
        "UPDATE blocos SET revisado=0, next_review=NULL, fsrs_state=0 WHERE id=?",
        (bloco_id,),
    )


def _deletar_bloco(conn, bloco_id: int) -> None:
    row = fetchone(
        conn,
        "SELECT id,documento_id,tipo,identificador,conteudo,ordem,importancia,"
        "revisado,last_review,next_review,stability,difficulty,reps "
        "FROM blocos WHERE id=?",
        (bloco_id,),
    )
    if row:
        _push_undo("delete_blocos", {"blocos": [_bloco_to_dict(row)]})
    execute(conn, "DELETE FROM blocos WHERE id=?", (bloco_id,))


def _novo_bloco_vazio(conn, documento_id: int) -> None:
    ordem = fetchall(
        conn,
        "SELECT COALESCE(MAX(ordem),0)+1 AS m FROM blocos WHERE documento_id=?",
        (documento_id,)
    )[0]["m"]
    execute(
        conn,
        "INSERT INTO blocos (documento_id,tipo,conteudo,ordem) VALUES(?,'texto_livre','',?)",
        (documento_id, ordem),
    )


# ── Sub-componentes de UI ─────────────────────────────────────────────────────

def _heatmap_bar(conn, bloco_id: int, importancia: str) -> None:
    """Barra sticky com botões de importância para o bloco ativo."""
    st.markdown(
        "<div class='heatmap-bar'>"
        "<span class='heatmap-label'>Importância:</span>",
        unsafe_allow_html=True,
    )
    c1, c2, c3, _ = st.columns([1.1, 1.5, 1.0, 6])
    with c1:
        active = importancia == "normal"
        if st.button(
            "⚪ Normal",
            key=f"imp_n_{bloco_id}",
            type="primary" if active else "secondary",
        ):
            _salvar_importancia(conn, bloco_id, "normal")
            st.rerun()
    with c2:
        active = importancia == "importante"
        if st.button(
            "🟡 Importante",
            key=f"imp_i_{bloco_id}",
            type="primary" if active else "secondary",
        ):
            _salvar_importancia(conn, bloco_id, "importante")
            st.rerun()
    with c3:
        active = importancia == "vital"
        if st.button(
            "🔴 Vital",
            key=f"imp_v_{bloco_id}",
            type="primary" if active else "secondary",
        ):
            _salvar_importancia(conn, bloco_id, "vital")
            st.rerun()
    st.markdown("</div>", unsafe_allow_html=True)


def _render_bloco(conn, bloco: dict, modo_selecao: bool = False) -> None:
    """Renderiza um único bloco em modo visualização, edição ou seleção múltipla."""
    bid         = bloco["id"]
    importancia = bloco["importancia"] or "normal"
    editing_id  = st.session_state.get("editing_id")
    active_id   = st.session_state.get("active_bloco_id")
    is_editing  = editing_id == bid
    is_active   = active_id  == bid
    cor_css     = _IMPORTANCIA_CSS.get(importancia, "")
    dot         = fsrs_dot(bloco["next_review"])

    # ── MODO SELEÇÃO MÚLTIPLA ─────────────────────────────────
    if modo_selecao:
        ident_html   = f"<span class='bloco-id'>{bloco['identificador']}</span> " if bloco["identificador"] else ""
        classes      = " ".join(filter(None, ["bloco-wrapper", cor_css]))
        conteudo_html = _md_to_html(bloco["conteudo"]) or "<em style='color:#aaa'>Bloco vazio</em>"
        sel_key      = f"sel_multi_{bid}"

        col_chk, col_txt = st.columns([0.4, 9.6])
        with col_chk:
            st.checkbox("", key=sel_key, label_visibility="collapsed")
        with col_txt:
            st.markdown(
                f"<div class='{classes}'>{ident_html}{conteudo_html}</div>",
                unsafe_allow_html=True,
            )
        return

    # ── MODO EDIÇÃO ───────────────────────────────────────────
    if is_editing:
        ta_key = f"ta_{bid}"

        def _auto_save():
            _salvar_conteudo(conn, bid, st.session_state.get(ta_key, ""))

        st.text_area(
            label="Editando bloco:",
            value=bloco["conteudo"],
            key=ta_key,
            height=130,
            on_change=_auto_save,
        )
        c1, c2, c3, _ = st.columns([1.1, 1.2, 1.1, 5])
        with c1:
            if st.button("✅ Salvar", key=f"save_{bid}"):
                # record_undo=True somente no salvar explícito (não no auto-save)
                _salvar_conteudo(conn, bid, st.session_state.get(ta_key, ""), record_undo=True)
                st.session_state["editing_id"] = None
                st.rerun()
        with c2:
            if st.button("❌ Cancelar", key=f"cancel_edit_{bid}"):
                st.session_state["editing_id"] = None
                st.rerun()
        with c3:
            if st.button("🗑️ Deletar", key=f"del_{bid}"):
                st.session_state[f"confirm_del_{bid}"] = True

        if st.session_state.get(f"confirm_del_{bid}"):
            st.warning("Deletar este bloco? Ação irreversível.")
            d1, d2 = st.columns(2)
            with d1:
                if st.button("Confirmar", key=f"del_ok_{bid}"):
                    _deletar_bloco(conn, bid)
                    st.session_state["editing_id"] = None
                    if st.session_state.get("active_bloco_id") == bid:
                        st.session_state["active_bloco_id"] = None
                    st.session_state.pop(f"confirm_del_{bid}", None)
                    st.rerun()
            with d2:
                if st.button("Cancelar", key=f"del_cancel_{bid}"):
                    st.session_state.pop(f"confirm_del_{bid}", None)
                    st.rerun()
        return

    # ── MODO VISUALIZAÇÃO ─────────────────────────────────────
    ident_html = (
        f"<span class='bloco-id'>{bloco['identificador']}</span> "
        if bloco["identificador"] else ""
    )
    cor_fonte   = bloco["cor_fonte"]   if "cor_fonte"   in bloco.keys() else "preto"
    alinhamento = bloco["alinhamento"] if "alinhamento" in bloco.keys() else "justificado"
    css_cor  = "bloco-fonte-bordo"         if cor_fonte   == "bordo"        else ""
    css_ali  = "bloco-alinhamento-centro"  if alinhamento == "centralizado" else ""
    classes  = " ".join(filter(None, [
        "bloco-wrapper", cor_css, "ativo" if is_active else "", css_cor, css_ali
    ]))
    conteudo_html = _md_to_html(bloco["conteudo"]) or "<em style='color:#aaa'>Bloco vazio</em>"

    col_dot, col_txt, col_sel, col_edit, col_opts = st.columns([0.35, 7.9, 0.45, 0.45, 0.45])

    with col_dot:
        # Ponto FSRS + checkbox de revisão
        revisado       = bool(bloco["revisado"])
        proxima_rev    = bloco["next_review"] or "—"
        show_rate_key  = f"fsrs_show_rating_{bid}"
        st.markdown(
            f"<div class='fsrs-dot' title='Próxima revisão: {proxima_rev}'>"
            f"{dot}</div>",
            unsafe_allow_html=True,
        )
        novo_val = st.checkbox(
            "", value=revisado, key=f"fsrs_{bid}", label_visibility="collapsed"
        )
        if novo_val and not revisado:
            # Marca como revisado com rating padrão "good"
            _marcar_revisao(conn, bid, dict(bloco), "good")
            st.session_state[show_rate_key] = True
            st.rerun()
        elif not novo_val and revisado:
            _desmarcar_revisao(conn, bid)
            st.session_state.pop(show_rate_key, None)
            st.rerun()

    with col_txt:
        # data-bid permite ao JS do menu de contexto identificar o bloco
        st.markdown(
            f"<div class='{classes}' data-bid='{bid}'>{ident_html}{conteudo_html}</div>",
            unsafe_allow_html=True,
        )

    with col_sel:
        sel_label = "🔵" if is_active else "🔗"
        if st.button(sel_label, key=f"sel_{bid}", help="Abrir anotações deste bloco"):
            st.session_state["active_bloco_id"] = bid
            st.session_state["editing_id"]      = None
            st.rerun()

    with col_edit:
        if st.button("✏️", key=f"edit_{bid}", help="Editar bloco"):
            st.session_state["editing_id"]      = bid
            st.session_state["active_bloco_id"] = bid
            st.rerun()

    with col_opts:
        # st.popover não aceita key= em versões antigas; usamos botão + session_state
        opts_key = f"showing_opts_{bid}"
        is_open  = st.session_state.get(opts_key, False)
        icon     = "✕" if is_open else "⋯"
        if st.button(icon, key=f"opts_btn_{bid}", help="Estilo do bloco"):
            st.session_state[opts_key] = not is_open
            st.rerun()

    # ── Painel de rating FSRS (aparece logo após marcar o checkbox) ──────────
    if st.session_state.get(f"fsrs_show_rating_{bid}"):
        with st.container(border=True):
            proxima = bloco["next_review"] or "—"
            stab    = bloco["stability"]
            st.caption(
                f"📅 FSRS — próxima revisão: **{proxima}** · "
                f"estabilidade: {stab:.2f}  \n"
                "Como foi este bloco? _(ajusta o agendamento)_"
            )
            rc1, rc2, rc3, rc4, rc5 = st.columns([2, 2, 2, 2, 1])
            rating_clicked = None
            with rc1:
                if st.button(RATING_LABELS["again"], key=f"rate_again_{bid}", use_container_width=True):
                    rating_clicked = "again"
            with rc2:
                if st.button(RATING_LABELS["hard"],  key=f"rate_hard_{bid}",  use_container_width=True):
                    rating_clicked = "hard"
            with rc3:
                if st.button(RATING_LABELS["good"],  key=f"rate_good_{bid}",  use_container_width=True):
                    rating_clicked = "good"
            with rc4:
                if st.button(RATING_LABELS["easy"],  key=f"rate_easy_{bid}",  use_container_width=True):
                    rating_clicked = "easy"
            with rc5:
                if st.button("✕", key=f"rate_close_{bid}", help="Fechar"):
                    st.session_state.pop(f"fsrs_show_rating_{bid}", None)
                    st.rerun()
            if rating_clicked:
                _marcar_revisao(conn, bid, dict(bloco), rating_clicked)
                st.session_state.pop(f"fsrs_show_rating_{bid}", None)
                st.rerun()

    # Painel de estilo (renderizado fora das colunas para evitar overflow)
    if st.session_state.get(f"showing_opts_{bid}"):
        with st.container(border=True):
            st.caption(f"🎨 Estilo — bloco #{bid}")
            cc1, cc2, cc3, cc4 = st.columns(4)
            with cc1:
                if st.button(
                    "⚫ Preto",
                    key=f"cor_p_{bid}",
                    type="primary" if cor_fonte == "preto" else "secondary",
                    use_container_width=True,
                ):
                    _salvar_estilo(conn, bid, "cor_fonte", "preto")
                    st.rerun()
            with cc2:
                if st.button(
                    "🟤 Bordô",
                    key=f"cor_b_{bid}",
                    type="primary" if cor_fonte == "bordo" else "secondary",
                    use_container_width=True,
                ):
                    _salvar_estilo(conn, bid, "cor_fonte", "bordo")
                    st.rerun()
            with cc3:
                if st.button(
                    "≡ Justificado",
                    key=f"ali_j_{bid}",
                    type="primary" if alinhamento == "justificado" else "secondary",
                    use_container_width=True,
                ):
                    _salvar_estilo(conn, bid, "alinhamento", "justificado")
                    st.rerun()
            with cc4:
                if st.button(
                    "≡ Centralizado",
                    key=f"ali_c_{bid}",
                    type="primary" if alinhamento == "centralizado" else "secondary",
                    use_container_width=True,
                ):
                    _salvar_estilo(conn, bid, "alinhamento", "centralizado")
                    st.rerun()


def _render_importar(conn, documento_id: int) -> None:
    """Expander para colar e auto-parsear texto jurídico."""
    # Contador: incrementar força uma nova chave no text_area (reset seguro)
    ctr_key = f"import_ctr_{documento_id}"
    if ctr_key not in st.session_state:
        st.session_state[ctr_key] = 0

    with st.expander("📥 Importar / Colar Texto", expanded=False):
        st.caption(
            "Cole o texto abaixo. Ele será fatiado automaticamente por artigos, "
            "parágrafos, incisos e alíneas."
        )
        chave = f"import_txt_{documento_id}_{st.session_state[ctr_key]}"
        texto = st.text_area(
            "Texto:",
            height=200,
            key=chave,
            placeholder="Art. 1º A República Federativa do Brasil...\n§ 1º ...\nI - ...",
        )
        c1, c2 = st.columns(2)
        with c1:
            if st.button("⚙️ Processar e Inserir", key=f"proc_{documento_id}"):
                if texto.strip():
                    blocos = _parse_texto(texto)
                    if blocos:
                        _inserir_blocos(conn, documento_id, blocos)
                        st.success(f"✅ {len(blocos)} blocos inseridos.")
                        st.session_state[ctr_key] += 1   # força novo widget vazio
                        st.rerun()
                    else:
                        st.warning("Nenhum bloco detectado. Verifique o formato.")
                else:
                    st.warning("Cole um texto antes de processar.")
        with c2:
            if st.button("🗑️ Limpar", key=f"limpar_{documento_id}"):
                st.session_state[ctr_key] += 1           # força novo widget vazio
                st.rerun()


# ── Ponto de entrada público ──────────────────────────────────────────────────

def render_document_viewer(conn, doc_id: int, doc_titulo: str) -> None:
    """
    Renderiza a coluna esquerda completa:
    - Cabeçalho do documento
    - Heatmap bar (quando bloco está selecionado)
    - Lista de blocos com Modo Edição + FSRS
    - Formulário de importação de texto
    - Botão de novo bloco vazio
    """

    # ── Cabeçalho ────────────────────────────────────────────
    col_h, col_undo, col_menu = st.columns([9, 1.5, 0.9])
    with col_h:
        st.markdown(
            f"<div class='doc-titulo'>{doc_titulo}</div>",
            unsafe_allow_html=True,
        )
    with col_undo:
        stack = st.session_state.get("undo_stack", [])
        undo_disabled = len(stack) == 0
        undo_help = f"Desfazer: {stack[-1]['action'].replace('_',' ')}" if stack else "Nada a desfazer"
        if st.button("↩ Desfazer", key=f"undo_btn_{doc_id}",
                     disabled=undo_disabled, help=undo_help, use_container_width=True):
            msg = _undo_last(conn)
            if msg:
                st.toast(msg)
            st.rerun()
    with col_menu:
        with st.popover("⋯"):
            if st.button("🗑️ Limpar todos os blocos", key=f"limpar_todos_{doc_id}"):
                st.session_state[f"confirm_limpar_{doc_id}"] = True

    # Confirmação fora do popover para melhor visibilidade
    if st.session_state.get(f"confirm_limpar_{doc_id}"):
        st.warning("⚠️ Deletar **todos** os blocos deste documento? Esta ação é irreversível.")
        c1, c2 = st.columns(2)
        with c1:
            if st.button("✅ Confirmar", key=f"confirm_limpar_ok_{doc_id}"):
                todos = fetchall(
                    conn,
                    "SELECT id,documento_id,tipo,identificador,conteudo,ordem,importancia,"
                    "revisado,last_review,next_review,stability,difficulty,reps "
                    "FROM blocos WHERE documento_id=? ORDER BY ordem",
                    (doc_id,),
                )
                if todos:
                    _push_undo("delete_blocos", {"blocos": [_bloco_to_dict(r) for r in todos]})
                execute(conn, "DELETE FROM blocos WHERE documento_id = ?", (doc_id,))
                st.session_state["active_bloco_id"] = None
                st.session_state["editing_id"]      = None
                st.session_state.pop(f"confirm_limpar_{doc_id}", None)
                st.rerun()
        with c2:
            if st.button("❌ Cancelar", key=f"confirm_limpar_cancel_{doc_id}"):
                st.session_state.pop(f"confirm_limpar_{doc_id}", None)
                st.rerun()

    # ── Importar texto ────────────────────────────────────────
    _render_importar(conn, doc_id)
    st.divider()

    # ── Blocos ────────────────────────────────────────────────
    blocos     = _get_blocos(conn, doc_id)
    active_bid = st.session_state.get("active_bloco_id")
    modo_sel   = st.session_state.get(f"modo_selecao_{doc_id}", False)

    if not blocos:
        st.markdown(
            "<div style='color:#aaa;font-size:0.9rem;padding:2rem 0;text-align:center;'>"
            "Nenhum bloco. Use <strong>📥 Importar</strong> ou <strong>＋ Novo Bloco</strong>."
            "</div>",
            unsafe_allow_html=True,
        )
    else:
        # Barra de controle: heatmap (modo normal) ou toolbar de seleção
        if modo_sel:
            c_info, c_del, c_cancel = st.columns([4, 2, 2])
            with c_info:
                n_sel = sum(
                    1 for b in blocos
                    if st.session_state.get(f"sel_multi_{b['id']}", False)
                )
                st.markdown(
                    f"<span style='font-size:0.82rem;color:#666;'>"
                    f"☑️ <b>{n_sel}</b> bloco(s) selecionado(s)</span>",
                    unsafe_allow_html=True,
                )
            with c_del:
                if st.button("🗑️ Deletar selecionados", key=f"del_sel_{doc_id}",
                             disabled=(n_sel == 0)):
                    st.session_state[f"confirm_del_sel_{doc_id}"] = True
            with c_cancel:
                if st.button("✖ Cancelar seleção", key=f"cancel_sel_{doc_id}"):
                    for b in blocos:
                        st.session_state.pop(f"sel_multi_{b['id']}", None)
                    st.session_state[f"modo_selecao_{doc_id}"] = False
                    st.rerun()

            # Confirmação de deleção em lote
            if st.session_state.get(f"confirm_del_sel_{doc_id}"):
                ids_sel = [b["id"] for b in blocos
                           if st.session_state.get(f"sel_multi_{b['id']}", False)]
                st.warning(f"⚠️ Deletar {len(ids_sel)} bloco(s) selecionado(s)? Irreversível.")
                cd1, cd2 = st.columns(2)
                with cd1:
                    if st.button("✅ Confirmar", key=f"del_sel_ok_{doc_id}"):
                        # Captura dados antes de deletar → undo único para o lote
                        placeholders = ",".join("?" * len(ids_sel))
                        rows_sel = fetchall(
                            conn,
                            f"SELECT id,documento_id,tipo,identificador,conteudo,ordem,importancia,"
                            f"revisado,last_review,next_review,stability,difficulty,reps "
                            f"FROM blocos WHERE id IN ({placeholders})",
                            tuple(ids_sel),
                        )
                        if rows_sel:
                            _push_undo("delete_blocos",
                                       {"blocos": [_bloco_to_dict(r) for r in rows_sel]})
                        for bid in ids_sel:
                            execute(conn, "DELETE FROM blocos WHERE id=?", (bid,))
                            st.session_state.pop(f"sel_multi_{bid}", None)
                        if st.session_state.get("active_bloco_id") in ids_sel:
                            st.session_state["active_bloco_id"] = None
                        st.session_state[f"modo_selecao_{doc_id}"]    = False
                        st.session_state.pop(f"confirm_del_sel_{doc_id}", None)
                        st.rerun()
                with cd2:
                    if st.button("❌ Cancelar", key=f"del_sel_cancel_{doc_id}"):
                        st.session_state.pop(f"confirm_del_sel_{doc_id}", None)
                        st.rerun()
        else:
            # Heatmap bar normal para bloco ativo
            if active_bid:
                bloco_ativo = next((b for b in blocos if b["id"] == active_bid), None)
                if bloco_ativo:
                    _heatmap_bar(conn, active_bid, bloco_ativo["importancia"] or "normal")

        for bloco in blocos:
            _render_bloco(conn, bloco, modo_selecao=modo_sel)

    st.divider()
    col_novo, col_sel_toggle = st.columns([6, 3])
    with col_novo:
        if st.button("＋ Novo Bloco", key=f"novo_bloco_{doc_id}", use_container_width=True):
            _novo_bloco_vazio(conn, doc_id)
            st.rerun()
    with col_sel_toggle:
        label = "✖ Sair da seleção" if modo_sel else "☑️ Selecionar blocos"
        if st.button(label, key=f"toggle_sel_{doc_id}", use_container_width=True):
            # Limpa checkboxes ao entrar/sair do modo
            if modo_sel:
                for b in blocos:
                    st.session_state.pop(f"sel_multi_{b['id']}", None)
            st.session_state[f"modo_selecao_{doc_id}"] = not modo_sel
            st.rerun()
