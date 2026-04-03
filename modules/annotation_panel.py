"""
modules/annotation_panel.py
Sprint 4 + 5 — Painel de Anotações de Link (coluna direita)

- Estado vazio motivacional quando nenhum bloco está selecionado
- CRUD de anotações vinculadas a blocos atômicos
- Tipos: texto livre, tabela Markdown, fluxograma Mermaid, portal
- Portais: busca FTS5 → insere ((bloco_id)) → renderiza conteúdo referenciado
- Auto-save por anotação (on_change) + salvar explícito
"""

import re
import streamlit as st
import streamlit.components.v1 as _components
from database.db_connection import fetchall, fetchone, execute

# ── Conversão Markdown → HTML inline (mesma lógica do document_viewer) ────────
_RE_MD_BI = re.compile(r'\*{3}(.+?)\*{3}', re.DOTALL)
_RE_MD_B  = re.compile(r'\*{2}(.+?)\*{2}', re.DOTALL)
_RE_MD_I  = re.compile(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', re.DOTALL)

def _md_to_html(text: str) -> str:
    if not text:
        return text
    text = _RE_MD_BI.sub(r'<strong><em>\1</em></strong>', text)
    text = _RE_MD_B.sub(r'<strong>\1</strong>', text)
    text = _RE_MD_I.sub(r'<em>\1</em>', text)
    return text

_RE_PORTAL = re.compile(r'^\(\((\d+)\)\)$')

# ── Constantes ────────────────────────────────────────────────────────────────

_TEMPLATES = {
    "texto": "",
    "tabela": (
        "| Coluna 1 | Coluna 2 | Coluna 3 |\n"
        "|----------|----------|----------|\n"
        "| Dado     | Dado     | Dado     |\n"
        "| Dado     | Dado     | Dado     |"
    ),
    "fluxograma": (
        "graph TD\n"
        "    A[Início] --> B{Decisão?}\n"
        "    B -->|Sim| C[Resultado A]\n"
        "    B -->|Não| D[Resultado B]"
    ),
}

_TIPO_ICON  = {"texto": "📝", "tabela": "📊", "fluxograma": "🔀", "portal": "🔗"}
_TIPO_LABEL = {"texto": "Texto", "tabela": "Tabela", "fluxograma": "Fluxograma", "portal": "Portal"}

_IMP_DOT = {"normal": "", "importante": "🟡", "vital": "🔴"}
_IMP_LABEL = {"normal": "Normal", "importante": "Importante", "vital": "Vital"}


# ── Acesso ao banco ───────────────────────────────────────────────────────────

def _get_anotacoes(conn, bloco_id: int) -> list:
    return fetchall(
        conn,
        "SELECT id, tipo, conteudo, ordem FROM anotacoes WHERE bloco_id=? ORDER BY ordem",
        (bloco_id,),
    )


def _nova_anotacao(conn, bloco_id: int, tipo: str) -> int:
    prox = fetchone(
        conn,
        "SELECT COALESCE(MAX(ordem),0)+1 AS m FROM anotacoes WHERE bloco_id=?",
        (bloco_id,),
    )["m"]
    new_id = execute(
        conn,
        "INSERT INTO anotacoes (bloco_id, tipo, conteudo, ordem) VALUES (?,?,?,?)",
        (bloco_id, tipo, _TEMPLATES[tipo], prox),
    )
    return new_id


def _salvar_anotacao(conn, anot_id: int, conteudo: str) -> None:
    execute(conn, "UPDATE anotacoes SET conteudo=? WHERE id=?", (conteudo.strip(), anot_id))


def _deletar_anotacao(conn, anot_id: int) -> None:
    execute(conn, "DELETE FROM anotacoes WHERE id=?", (anot_id,))


def _buscar_blocos_fts(conn, query: str) -> list:
    """
    Busca blocos E anotações de link pelo termo informado.
    Retorna dicts com: id (bloco), identificador, conteudo, doc, origem.
      origem = 'bloco'    → match no próprio texto do bloco
      origem = 'anotacao' → match em uma anotação vinculada ao bloco
    Resultados são deduplicados por bloco_id; o bloco sempre é o destino
    do portal, independentemente de onde o match ocorreu.
    """
    query = query.strip()
    if not query:
        return []

    vistos: set = set()
    resultados: list = []

    def _add(rows, origem: str) -> None:
        for r in rows:
            bid = r["id"]
            if bid not in vistos:
                vistos.add(bid)
                # sqlite3.Row não tem .get(); usar acesso direto (NULL → None)
                try:
                    match_txt = r["match_texto"] or r["conteudo"]
                except (IndexError, KeyError):
                    match_txt = r["conteudo"]
                resultados.append({
                    "id":            bid,
                    "identificador": r["identificador"],
                    "conteudo":      r["conteudo"],
                    "doc":           r["doc"],
                    "origem":        origem,
                    "match_texto":   match_txt,
                })

    # ── 1. FTS5 nos blocos ────────────────────────────────────────
    try:
        rows = fetchall(
            conn,
            """SELECT b.id, b.identificador, b.conteudo, d.titulo AS doc,
                      NULL AS match_texto
               FROM blocos_fts f
               JOIN blocos     b ON b.id = f.rowid
               JOIN documentos d ON d.id = b.documento_id
               WHERE blocos_fts MATCH ?
               LIMIT 12""",
            (query + "*",),
        )
        _add(rows, "bloco")
    except Exception:
        pass

    # ── 2. LIKE nos blocos (fallback / complemento) ───────────────
    if not resultados:
        rows = fetchall(
            conn,
            """SELECT b.id, b.identificador, b.conteudo, d.titulo AS doc,
                      NULL AS match_texto
               FROM blocos b JOIN documentos d ON d.id = b.documento_id
               WHERE b.conteudo LIKE ? OR b.identificador LIKE ?
               LIMIT 12""",
            (f"%{query}%", f"%{query}%"),
        )
        _add(rows, "bloco")

    # ── 3. LIKE nas anotações de link ─────────────────────────────
    # Busca em anotacoes.conteudo e retorna o bloco pai como destino.
    rows_anot = fetchall(
        conn,
        """SELECT b.id, b.identificador, b.conteudo, d.titulo AS doc,
                  a.conteudo AS match_texto
           FROM anotacoes   a
           JOIN blocos      b ON b.id = a.bloco_id
           JOIN documentos  d ON d.id = b.documento_id
           WHERE a.tipo != 'portal'
             AND a.conteudo LIKE ?
           LIMIT 12""",
        (f"%{query}%",),
    )
    _add(rows_anot, "anotacao")

    return resultados[:16]


def _render_portal_busca(conn, bloco_id: int) -> None:
    """Formulário de busca FTS5 para inserir um portal."""
    st.markdown("**🔍 Buscar bloco para linkar:**")
    q = st.text_input(
        "Buscar...",
        key=f"portal_q_{bloco_id}",
        placeholder="Art. 5, § 1º, palavra-chave…",
    )
    resultados = _buscar_blocos_fts(conn, q) if q else []

    if q and not resultados:
        st.caption("Nenhum resultado.")

    for r in resultados:
        ident   = r["identificador"] or ""
        # Mostra o trecho que gerou o match (pode ser do bloco ou da anotação)
        match   = (r.get("match_texto") or r["conteudo"] or "")
        preview = match[:70] + "…" if len(match) > 70 else match
        origem_tag = "📝 anotação" if r.get("origem") == "anotacao" else "📄 bloco"
        label = (
            f"[{r['doc']}] {ident} ({origem_tag}) — {preview}"
            if ident
            else f"[{r['doc']}] ({origem_tag}) — {preview}"
        )
        if st.button(label, key=f"portal_pick_{bloco_id}_{r['id']}"):
            prox = fetchone(
                conn,
                "SELECT COALESCE(MAX(ordem),0)+1 AS m FROM anotacoes WHERE bloco_id=?",
                (bloco_id,),
            )["m"]
            execute(
                conn,
                "INSERT INTO anotacoes (bloco_id, tipo, conteudo, ordem) VALUES (?,?,?,?)",
                (bloco_id, "portal", f"(({r['id']}))", prox),
            )
            try:
                execute(
                    conn,
                    "INSERT OR IGNORE INTO portais (bloco_origem_id, bloco_alvo_id) VALUES (?,?)",
                    (bloco_id, r["id"]),
                )
            except Exception:
                pass
            st.session_state.pop(f"show_portal_busca_{bloco_id}", None)
            st.rerun()

    if st.button("✖ Cancelar", key=f"portal_cancel_{bloco_id}"):
        st.session_state.pop(f"show_portal_busca_{bloco_id}", None)
        st.rerun()


# ── Renderização de conteúdo ──────────────────────────────────────────────────

def _render_portal_ref(conn, conteudo: str) -> None:
    """
    Renderiza uma anotação do tipo portal: exibe o bloco referenciado
    seguido de todas as anotações de link vinculadas a ele.
    """
    m = _RE_PORTAL.match(conteudo.strip())
    if not m:
        st.markdown(conteudo, unsafe_allow_html=True)
        return

    ref_id = int(m.group(1))
    ref = fetchone(
        conn,
        "SELECT identificador, conteudo, importancia FROM blocos WHERE id=?",
        (ref_id,),
    )
    if not ref:
        st.markdown(
            f"<div class='portal-ref portal-quebrado'>⚠️ Bloco <code>{ref_id}</code> não encontrado.</div>",
            unsafe_allow_html=True,
        )
        return

    # ── Texto principal do bloco ──────────────────────────────────
    ident   = ref["identificador"] or ""
    imp     = ref["importancia"] or "normal"
    imp_cls = {"importante": "importante", "vital": "vital"}.get(imp, "")
    ident_h = f"<span class='bloco-id'>{ident}</span> " if ident else ""
    st.markdown(
        f"<div class='portal-ref {imp_cls}'>"
        f"<span class='portal-icon'>🔗</span> {ident_h}{_md_to_html(ref['conteudo'])}"
        f"</div>",
        unsafe_allow_html=True,
    )

    # ── Anotações de link do bloco referenciado ───────────────────
    anotacoes = fetchall(
        conn,
        "SELECT tipo, conteudo FROM anotacoes WHERE bloco_id=? ORDER BY ordem",
        (ref_id,),
    )
    if not anotacoes:
        return

    for anot in anotacoes:
        tipo     = anot["tipo"]
        conteudo_anot = anot["conteudo"] or ""
        if not conteudo_anot.strip():
            continue
        # Evita recursão infinita: portais dentro de portais não são expandidos
        if tipo == "portal":
            ref_m = _RE_PORTAL.match(conteudo_anot.strip())
            ref_inner = int(ref_m.group(1)) if ref_m else None
            st.markdown(
                f"<div class='portal-anot-item portal-anot-portal'>"
                f"🔗 Portal → bloco <code>{ref_inner or conteudo_anot}</code>"
                f"</div>",
                unsafe_allow_html=True,
            )
        elif tipo == "fluxograma":
            st.markdown(
                f"<div class='portal-anot-item portal-anot-fluxo'>"
                f"🔀 <em>Fluxograma (abra o painel para visualizar)</em>"
                f"</div>",
                unsafe_allow_html=True,
            )
        elif tipo == "tabela":
            st.markdown(
                f"<div class='portal-anot-item'>📊</div>",
                unsafe_allow_html=True,
            )
            st.markdown(conteudo_anot, unsafe_allow_html=True)
        else:  # texto
            st.markdown(
                f"<div class='portal-anot-item'>{_md_to_html(conteudo_anot)}</div>",
                unsafe_allow_html=True,
            )


def _render_mermaid(codigo: str, height: int = 280) -> None:
    """Renderiza um diagrama Mermaid via CDN."""
    safe = codigo.replace("`", "&#96;").replace("<", "&lt;").replace(">", "&gt;")
    _components.html(
        f"""
        <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
        <div class="mermaid" style="font-family:Inter,sans-serif;font-size:13px;">{safe}</div>
        <script>mermaid.initialize({{startOnLoad:true,theme:'neutral',securityLevel:'loose'}});</script>
        """,
        height=height,
        scrolling=True,
    )


def _render_anotacao(conn, anot) -> None:
    """Renderiza um card de anotação em modo visualização ou edição."""
    aid      = anot["id"]
    tipo     = anot["tipo"]
    conteudo = anot["conteudo"] or ""
    is_edit  = st.session_state.get("editing_anotacao_id") == aid
    ta_key   = f"ta_anot_{aid}"

    with st.container(border=True):
        # ── Cabeçalho do card ────────────────────────────────────
        col_badge, _, col_edit, col_del = st.columns([2.2, 5, 0.65, 0.65])
        with col_badge:
            st.markdown(
                f"<span class='anot-badge anot-{tipo}'>"
                f"{_TIPO_ICON[tipo]} {_TIPO_LABEL[tipo]}"
                f"</span>",
                unsafe_allow_html=True,
            )
        with col_edit:
            if st.button(
                "✅" if is_edit else "✏️",
                key=f"edit_anot_{aid}",
                help="Salvar" if is_edit else "Editar",
            ):
                if is_edit:
                    _salvar_anotacao(conn, aid, st.session_state.get(ta_key, conteudo))
                    st.session_state["editing_anotacao_id"] = None
                else:
                    st.session_state["editing_anotacao_id"] = aid
                st.rerun()
        with col_del:
            if st.button("🗑️", key=f"del_anot_{aid}", help="Deletar anotação"):
                _deletar_anotacao(conn, aid)
                if st.session_state.get("editing_anotacao_id") == aid:
                    st.session_state["editing_anotacao_id"] = None
                st.rerun()

        # ── Corpo do card ────────────────────────────────────────
        if is_edit:
            h = 200 if tipo == "fluxograma" else 140
            st.text_area(
                label="",
                value=conteudo,
                key=ta_key,
                height=h,
                label_visibility="collapsed",
                on_change=lambda: _salvar_anotacao(
                    conn, aid, st.session_state.get(ta_key, "")
                ),
                placeholder=(
                    "Digite o texto aqui..."
                    if tipo == "texto"
                    else f"Edite o código {_TIPO_LABEL[tipo]} aqui..."
                ),
            )
        else:
            if not conteudo.strip():
                st.markdown(
                    "<span class='anot-vazia'>Vazio — clique em ✏️ para editar.</span>",
                    unsafe_allow_html=True,
                )
            elif tipo == "portal":
                _render_portal_ref(conn, conteudo)
            elif tipo == "fluxograma":
                _render_mermaid(conteudo)
            else:
                st.markdown(conteudo, unsafe_allow_html=True)


# ── Painel principal ──────────────────────────────────────────────────────────

def render_annotation_panel(conn, bloco_id, doc_titulo: str = "") -> None:
    """
    Renderiza a coluna direita completa.

    - Se bloco_id é None: exibe estado vazio motivacional.
    - Se bloco_id está definido: cabeçalho do bloco + CRUD de anotações.
    """

    # ── Estado vazio: nenhum bloco selecionado ────────────────────
    if bloco_id is None:
        st.markdown(
            """
            <div class="anot-empty-state">
                <div class="anot-empty-icon">✍️</div>
                <div class="anot-empty-title">
                    Selecione um bloco para visualizar suas anotações.
                </div>
                <div class="anot-empty-hint">
                    Clique no ícone <strong>🔗</strong> ao lado de qualquer
                    parágrafo para abrir ou criar anotações vinculadas.
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        return

    # ── Recupera dados do bloco ───────────────────────────────────
    bloco = fetchone(
        conn,
        "SELECT id, tipo, identificador, conteudo, importancia FROM blocos WHERE id=?",
        (bloco_id,),
    )
    if not bloco:
        st.warning("Bloco não encontrado. Pode ter sido deletado.")
        st.session_state["active_bloco_id"] = None
        return

    ident = bloco["identificador"] or ""
    imp   = bloco["importancia"] or "normal"
    dot   = _IMP_DOT.get(imp, "")

    if ident:
        label_bloco = f"{dot} {ident}".strip()
    else:
        tipo_map = {
            "artigo":     "Artigo",
            "paragrafo":  "§",
            "inciso":     "Inciso",
            "alinea":     "Alínea",
            "cabecalho":  "Cabeçalho",
            "texto_livre":"Bloco",
        }
        label_bloco = f"{dot} {tipo_map.get(bloco['tipo'], 'Bloco')} #{bloco_id}".strip()

    # ── Cabeçalho do painel ───────────────────────────────────────
    col_info, col_fechar = st.columns([9, 1])
    with col_info:
        st.markdown(
            f"""
            <div class="anot-header">
                <div class="anot-header-doc">{doc_titulo}</div>
                <div class="anot-header-bloco">{label_bloco}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with col_fechar:
        if st.button("✕", key="fechar_painel", help="Fechar painel de anotações"):
            st.session_state["active_bloco_id"] = None
            st.rerun()

    st.divider()

    # ── Lista de anotações ────────────────────────────────────────
    anotacoes = _get_anotacoes(conn, bloco_id)

    if not anotacoes:
        st.markdown(
            "<div class='anot-none'>Nenhuma anotação ainda. "
            "Adicione uma abaixo ↓</div>",
            unsafe_allow_html=True,
        )
    else:
        for anot in anotacoes:
            _render_anotacao(conn, anot)

    # ── Botões de adição ──────────────────────────────────────────
    st.markdown("<div style='height:0.4rem'></div>", unsafe_allow_html=True)
    c1, c2, c3, c4 = st.columns(4)
    with c1:
        if st.button("＋ Texto", key=f"add_txt_{bloco_id}", use_container_width=True):
            new_id = _nova_anotacao(conn, bloco_id, "texto")
            st.session_state["editing_anotacao_id"] = new_id
            st.rerun()
    with c2:
        if st.button("＋ Tabela", key=f"add_tab_{bloco_id}", use_container_width=True):
            new_id = _nova_anotacao(conn, bloco_id, "tabela")
            st.session_state["editing_anotacao_id"] = new_id
            st.rerun()
    with c3:
        if st.button("＋ Fluxograma", key=f"add_flx_{bloco_id}", use_container_width=True):
            new_id = _nova_anotacao(conn, bloco_id, "fluxograma")
            st.session_state["editing_anotacao_id"] = new_id
            st.rerun()
    with c4:
        if st.button("🔗 Portal", key=f"add_portal_{bloco_id}", use_container_width=True):
            st.session_state[f"show_portal_busca_{bloco_id}"] = True
            st.rerun()

    # ── Formulário de busca de portal ────────────────────────────
    if st.session_state.get(f"show_portal_busca_{bloco_id}"):
        with st.container(border=True):
            _render_portal_busca(conn, bloco_id)
