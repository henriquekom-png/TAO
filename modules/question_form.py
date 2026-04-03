"""
modules/question_form.py
Sprint 10 — Cadastro e gerenciamento de questões de concurso.

Funcionalidades:
  - Formulário completo: banca, ano, cargo, matéria, tipo, enunciado,
    alternativas A–E, gabarito, comentário, dificuldade, vínculo a bloco.
  - Lista paginada com filtros por matéria, banca e dificuldade.
  - Edição e exclusão de questões.
"""

from __future__ import annotations

import streamlit as st
from database.db_connection import fetchall, fetchone, execute

# ── Constantes ────────────────────────────────────────────────────────────────
BANCAS = ["", "CESPE/CEBRASPE", "FCC", "VUNESP", "ESAF", "FGV", "IADES",
          "FUNDATEC", "AOCP", "UPENET", "NC-UFPR", "Outra"]
DIFICULDADE_ICONS = {"facil": "⚪ Fácil", "media": "🟡 Média", "dificil": "🔴 Difícil"}
TIPO_LABELS = {
    "multipla_escolha": "Múltipla escolha (A–E)",
    "certo_errado":     "Certo / Errado",
    "combinacao_itens": "Combinação de itens (I, II, III…)",
}
NUMEROS_ROMANOS = ["I", "II", "III", "IV", "V", "VI", "VII"]


# ── Helpers de banco ──────────────────────────────────────────────────────────

def _listar_questoes(conn, materia: str = "", banca: str = "",
                     dificuldade: str = "") -> list:
    filters, params = [], []
    if materia:
        filters.append("LOWER(materia) LIKE LOWER(?)")
        params.append(f"%{materia}%")
    if banca:
        filters.append("banca = ?")
        params.append(banca)
    if dificuldade:
        filters.append("dificuldade = ?")
        params.append(dificuldade)
    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    return fetchall(
        conn,
        f"""SELECT id, banca, ano, cargo, materia, tipo, enunciado,
                   alternativa_a, alternativa_b, alternativa_c,
                   alternativa_d, alternativa_e,
                   gabarito, comentario, dificuldade, bloco_origem_id
            FROM questoes {where}
            ORDER BY materia, criado_em DESC""",
        tuple(params),
    )


def _salvar_questao(conn, dados: dict, questao_id: int | None = None) -> int:
    """Salva/atualiza a questão e retorna o id."""
    cols = ["banca", "ano", "cargo", "materia", "tipo", "enunciado",
            "alternativa_a", "alternativa_b", "alternativa_c",
            "alternativa_d", "alternativa_e",
            "gabarito", "comentario", "dificuldade", "bloco_origem_id"]
    vals = tuple(dados.get(c) or None for c in cols)
    if questao_id:
        sets = ", ".join(f"{c}=?" for c in cols)
        execute(conn, f"UPDATE questoes SET {sets} WHERE id=?", vals + (questao_id,))
        return questao_id
    else:
        placeholders = ", ".join("?" * len(cols))
        new_id = execute(
            conn,
            f"INSERT INTO questoes ({', '.join(cols)}) VALUES ({placeholders})",
            vals,
        )
        return new_id


def _deletar_questao(conn, questao_id: int) -> None:
    execute(conn, "DELETE FROM questoes WHERE id=?", (questao_id,))


def _get_itens(conn, questao_id: int) -> list:
    """Retorna os itens romanos de uma questão."""
    return fetchall(
        conn,
        "SELECT id, numero, enunciado, correto FROM questao_itens "
        "WHERE questao_id=? ORDER BY ordem",
        (questao_id,),
    )


def _salvar_itens(conn, questao_id: int, itens: list[dict]) -> None:
    """Substitui todos os itens da questão pelos novos."""
    execute(conn, "DELETE FROM questao_itens WHERE questao_id=?", (questao_id,))
    for i, item in enumerate(itens):
        if item.get("enunciado", "").strip():
            execute(
                conn,
                "INSERT INTO questao_itens (questao_id, numero, enunciado, correto, ordem) "
                "VALUES (?,?,?,?,?)",
                (questao_id, item["numero"], item["enunciado"].strip(),
                 item.get("correto"), i),
            )


def _buscar_blocos(conn, termo: str) -> list:
    """Busca blocos pelo conteúdo para vincular à questão."""
    if not termo or len(termo) < 3:
        return []
    return fetchall(
        conn,
        """SELECT b.id, b.identificador, b.conteudo, d.titulo AS doc_titulo
           FROM blocos b
           JOIN documentos d ON b.documento_id = d.id
           WHERE b.conteudo LIKE ?
           LIMIT 12""",
        (f"%{termo}%",),
    )


# ── Formulário ────────────────────────────────────────────────────────────────

def _render_form(conn, questao: dict | None = None) -> None:
    """Renderiza o formulário de cadastro/edição."""
    is_edit = questao is not None
    prefix  = f"qedit_{questao['id']}_" if is_edit else "qnova_"
    q       = questao or {}

    st.subheader("✏️ Editar questão" if is_edit else "➕ Nova questão")

    # ── Linha 1: banca / ano / cargo ─────────────────────────────
    c1, c2, c3 = st.columns([2, 1, 2])
    with c1:
        banca = st.selectbox(
            "Banca", BANCAS,
            index=BANCAS.index(q.get("banca") or "") if (q.get("banca") or "") in BANCAS else 0,
            key=f"{prefix}banca",
        )
    with c2:
        ano = st.number_input(
            "Ano", min_value=1990, max_value=2030,
            value=int(q.get("ano") or 2024),
            step=1, key=f"{prefix}ano",
        )
    with c3:
        cargo = st.text_input("Cargo / Concurso", value=q.get("cargo") or "",
                              key=f"{prefix}cargo")

    # ── Linha 2: matéria / tipo / dificuldade ────────────────────
    c4, c5, c6 = st.columns([3, 2, 2])
    with c4:
        materia = st.text_input(
            "Matéria / Assunto *",
            value=q.get("materia") or "",
            placeholder="Ex.: Art. 5º — Direitos Fundamentais — CF",
            key=f"{prefix}materia",
        )
    with c5:
        tipo_opts  = list(TIPO_LABELS.keys())
        tipo_atual = q.get("tipo") or "multipla_escolha"
        tipo       = st.selectbox(
            "Tipo", tipo_opts,
            index=tipo_opts.index(tipo_atual),
            format_func=lambda x: TIPO_LABELS[x],
            key=f"{prefix}tipo",
        )
    with c6:
        dif_opts  = list(DIFICULDADE_ICONS.keys())
        dif_atual = q.get("dificuldade") or "media"
        dificuldade = st.selectbox(
            "Dificuldade", dif_opts,
            index=dif_opts.index(dif_atual),
            format_func=lambda x: DIFICULDADE_ICONS[x],
            key=f"{prefix}dif",
        )

    # ── Enunciado ────────────────────────────────────────────────
    enunciado = st.text_area(
        "Enunciado *",
        value=q.get("enunciado") or "",
        height=120,
        key=f"{prefix}enunciado",
    )

    # ── Itens romanos (apenas para combinacao_itens) ─────────────
    itens_form: list[dict] = []
    if tipo == "combinacao_itens":
        st.markdown("**Afirmações (itens I, II, III…)**")
        # Carrega itens existentes (edição) ou inicializa com 4 vazios
        if is_edit and q.get("id"):
            itens_db = _get_itens(conn, q["id"])
            itens_init = [{"numero": r["numero"], "enunciado": r["enunciado"],
                           "correto": r["correto"]} for r in itens_db]
        else:
            itens_init = []

        n_key = f"{prefix}n_itens"
        if n_key not in st.session_state:
            st.session_state[n_key] = max(4, len(itens_init))
        n_itens = st.session_state[n_key]

        for i in range(n_itens):
            num   = NUMEROS_ROMANOS[i] if i < len(NUMEROS_ROMANOS) else str(i + 1)
            init  = itens_init[i] if i < len(itens_init) else {}
            ci1, ci2, ci3 = st.columns([0.5, 6, 1.5])
            with ci1:
                st.markdown(f"**{num})**")
            with ci2:
                txt = st.text_input(
                    f"Item {num}", label_visibility="collapsed",
                    value=init.get("enunciado", ""),
                    placeholder=f"Enunciado do item {num}…",
                    key=f"{prefix}item_{i}",
                )
            with ci3:
                correto_opts = [None, True, False]
                correto_labels = {None: "—", True: "✅ Correto", False: "❌ Errado"}
                c_init = init.get("correto")
                c_idx  = correto_opts.index(c_init) if c_init in correto_opts else 0
                correto_sel = st.selectbox(
                    "Correto?", correto_opts,
                    index=c_idx,
                    format_func=lambda x: correto_labels[x],
                    key=f"{prefix}correto_{i}",
                    label_visibility="collapsed",
                )
            if txt.strip():
                itens_form.append({"numero": num, "enunciado": txt,
                                   "correto": correto_sel})

        ca, cr = st.columns([1, 1])
        with ca:
            if n_itens < len(NUMEROS_ROMANOS):
                if st.button("➕ Adicionar item", key=f"{prefix}add_item"):
                    st.session_state[n_key] = n_itens + 1
                    st.rerun()
        with cr:
            if n_itens > 2:
                if st.button("➖ Remover último", key=f"{prefix}rem_item"):
                    st.session_state[n_key] = n_itens - 1
                    st.rerun()

        st.divider()

    # ── Alternativas (múltipla escolha e combinacao_itens) ────────
    alt_vals = {}
    if tipo in ("multipla_escolha", "combinacao_itens"):
        label = "**Alternativas** (combinações dos itens acima)" \
                if tipo == "combinacao_itens" else "**Alternativas**"
        st.markdown(label)
        for letra in "ABCDE":
            alt_vals[letra] = st.text_input(
                f"{letra})",
                value=q.get(f"alternativa_{letra.lower()}") or "",
                key=f"{prefix}alt_{letra}",
            )

    # ── Gabarito ─────────────────────────────────────────────────
    if tipo in ("multipla_escolha", "combinacao_itens"):
        gab_opts   = ["A", "B", "C", "D", "E"]
        gab_atual  = q.get("gabarito") or "A"
        gab_idx    = gab_opts.index(gab_atual) if gab_atual in gab_opts else 0
        gabarito   = st.selectbox("Gabarito *", gab_opts, index=gab_idx,
                                  key=f"{prefix}gab")
    else:
        gab_opts  = ["C", "E"]
        gab_atual = q.get("gabarito") or "C"
        gab_idx   = 0 if gab_atual == "C" else 1
        gabarito  = st.selectbox(
            "Gabarito *", gab_opts, index=gab_idx,
            format_func=lambda x: "✅ Certo" if x == "C" else "❌ Errado",
            key=f"{prefix}gab",
        )

    # ── Comentário ───────────────────────────────────────────────
    comentario = st.text_area(
        "💬 Gabarito comentado",
        value=q.get("comentario") or "",
        height=140,
        placeholder=(
            "A) ERRADA — motivo...\n"
            "B) CORRETA — reproduz fielmente o art. X...\n"
            "C) ERRADA — confunde com o § Y..."
        ),
        key=f"{prefix}comentario",
    )

    # ── Vínculo ao bloco ─────────────────────────────────────────
    st.markdown("**🔗 Vincular ao bloco do documento** _(opcional)_")
    busca_key = f"{prefix}busca_bloco"
    busca     = st.text_input(
        "Buscar bloco (digite parte do texto):",
        value="",
        key=busca_key,
        placeholder='Ex.: "art. 5" ou "isonomia"',
    )
    bloco_origem_id = q.get("bloco_origem_id") or None

    if busca:
        resultados = _buscar_blocos(conn, busca)
        if resultados:
            opcoes = {
                f"[{r['doc_titulo']}] {(r['identificador'] or '')} {r['conteudo'][:80]}…": r["id"]
                for r in resultados
            }
            escolhido = st.selectbox(
                "Selecione o bloco:", list(opcoes.keys()),
                key=f"{prefix}sel_bloco",
            )
            bloco_origem_id = opcoes[escolhido]
            st.success(f"✅ Bloco #{bloco_origem_id} selecionado.")
        else:
            st.caption("Nenhum bloco encontrado.")

    if bloco_origem_id and not busca:
        bloco_info = fetchone(conn, "SELECT conteudo FROM blocos WHERE id=?",
                              (bloco_origem_id,))
        if bloco_info:
            st.caption(f"🔗 Vinculado ao bloco #{bloco_origem_id}: "
                       f"_{bloco_info['conteudo'][:80]}…_")

    # ── Botões ───────────────────────────────────────────────────
    b1, b2 = st.columns([1, 1])
    with b1:
        salvar = st.button(
            "💾 Salvar questão" if not is_edit else "💾 Atualizar",
            type="primary",
            use_container_width=True,
            key=f"{prefix}salvar",
        )
    with b2:
        cancelar = st.button(
            "✕ Cancelar",
            use_container_width=True,
            key=f"{prefix}cancelar",
        )

    if cancelar:
        st.session_state.pop("editing_questao_id", None)
        st.session_state.pop("show_nova_questao", None)
        st.rerun()

    if salvar:
        if not materia.strip():
            st.error("O campo **Matéria / Assunto** é obrigatório.")
            return
        if not enunciado.strip():
            st.error("O campo **Enunciado** é obrigatório.")
            return

        if tipo == "combinacao_itens" and not itens_form:
            st.error("Adicione ao menos **2 itens** (I, II…) para este tipo de questão.")
            return

        dados = {
            "banca":          banca or None,
            "ano":            int(ano),
            "cargo":          cargo or None,
            "materia":        materia.strip(),
            "tipo":           tipo,
            "enunciado":      enunciado.strip(),
            "alternativa_a":  alt_vals.get("A") or None,
            "alternativa_b":  alt_vals.get("B") or None,
            "alternativa_c":  alt_vals.get("C") or None,
            "alternativa_d":  alt_vals.get("D") or None,
            "alternativa_e":  alt_vals.get("E") or None,
            "gabarito":       gabarito,
            "comentario":     comentario.strip() or None,
            "dificuldade":    dificuldade,
            "bloco_origem_id": bloco_origem_id,
        }
        qid = _salvar_questao(conn, dados,
                              questao_id=questao["id"] if is_edit else None)
        if tipo == "combinacao_itens":
            _salvar_itens(conn, qid, itens_form)
        # Limpa n_itens da sessão para evitar lixo
        st.session_state.pop(f"{prefix}n_itens", None)
        st.session_state.pop("editing_questao_id", None)
        st.session_state.pop("show_nova_questao", None)
        st.success("✅ Questão salva!" if not is_edit else "✅ Questão atualizada!")
        st.rerun()


# ── Lista de questões ─────────────────────────────────────────────────────────

def _render_lista(conn) -> None:
    """Renderiza a lista de questões com filtros."""
    # ── Filtros ───────────────────────────────────────────────────
    fc1, fc2, fc3 = st.columns([3, 2, 2])
    with fc1:
        f_materia = st.text_input("🔍 Filtrar por matéria", key="qlist_mat",
                                  placeholder="Ex.: Direito Constitucional")
    with fc2:
        f_banca = st.selectbox("Banca", ["(todas)"] + BANCAS[1:], key="qlist_banca")
        if f_banca == "(todas)":
            f_banca = ""
    with fc3:
        f_dif = st.selectbox(
            "Dificuldade", ["(todas)", "facil", "media", "dificil"],
            format_func=lambda x: "(todas)" if x == "(todas)" else DIFICULDADE_ICONS[x],
            key="qlist_dif",
        )
        if f_dif == "(todas)":
            f_dif = ""

    questoes = _listar_questoes(conn, f_materia, f_banca, f_dif)

    st.caption(f"**{len(questoes)} questão(ões) encontrada(s)**")

    if not questoes:
        st.info("Nenhuma questão cadastrada. Clique em **➕ Nova questão** para começar.")
        return

    for q in questoes:
        dif_icon = DIFICULDADE_ICONS.get(q["dificuldade"], "")
        banca_str = f"{q['banca']} {q['ano']}" if q["banca"] else str(q["ano"] or "")
        header = f"{dif_icon}  [{banca_str}]  {q['materia']}"

        with st.expander(header, expanded=False):
            st.markdown(f"**Tipo:** {TIPO_LABELS.get(q['tipo'], q['tipo'])}")
            st.markdown(f"**Enunciado:**\n\n{q['enunciado']}")

            if q["tipo"] == "combinacao_itens":
                # Exibe itens romanos
                itens = _get_itens(conn, q["id"])
                if itens:
                    st.markdown("**Itens:**")
                    for it in itens:
                        cor_icon = ("✅" if it["correto"] == 1
                                    else ("❌" if it["correto"] == 0 else "❔"))
                        st.markdown(f"{cor_icon} **{it['numero']})** {it['enunciado']}")
                st.markdown("**Alternativas:**")
                for letra in "ABCDE":
                    alt = q[f"alternativa_{letra.lower()}"]
                    if alt:
                        icon = "✅" if letra == q["gabarito"] else "  "
                        st.markdown(f"{icon} **{letra})** {alt}")
            elif q["tipo"] == "multipla_escolha":
                for letra in "ABCDE":
                    alt = q[f"alternativa_{letra.lower()}"]
                    if alt:
                        icon = "✅" if letra == q["gabarito"] else "  "
                        st.markdown(f"{icon} **{letra})** {alt}")
            else:
                st.markdown(
                    f"**Gabarito:** {'✅ Certo' if q['gabarito'] == 'C' else '❌ Errado'}"
                )

            if q["comentario"]:
                with st.container(border=True):
                    st.caption("💬 Gabarito comentado")
                    st.markdown(q["comentario"])

            if q["bloco_origem_id"]:
                bloco = fetchone(conn, "SELECT conteudo FROM blocos WHERE id=?",
                                 (q["bloco_origem_id"],))
                if bloco:
                    st.caption(f"🔗 Bloco vinculado: _{bloco['conteudo'][:100]}…_")

            ce1, ce2 = st.columns(2)
            with ce1:
                if st.button("✏️ Editar", key=f"qedit_btn_{q['id']}",
                             use_container_width=True):
                    st.session_state["editing_questao_id"] = q["id"]
                    st.session_state.pop("show_nova_questao", None)
                    st.rerun()
            with ce2:
                if st.button("🗑️ Excluir", key=f"qdel_btn_{q['id']}",
                             use_container_width=True):
                    st.session_state[f"confirm_del_q_{q['id']}"] = True

            if st.session_state.get(f"confirm_del_q_{q['id']}"):
                st.warning("Confirmar exclusão desta questão?")
                cc1, cc2 = st.columns(2)
                with cc1:
                    if st.button("✅ Sim, excluir", key=f"qdelok_{q['id']}",
                                 use_container_width=True):
                        _deletar_questao(conn, q["id"])
                        st.session_state.pop(f"confirm_del_q_{q['id']}", None)
                        st.rerun()
                with cc2:
                    if st.button("❌ Cancelar", key=f"qdelno_{q['id']}",
                                 use_container_width=True):
                        st.session_state.pop(f"confirm_del_q_{q['id']}", None)
                        st.rerun()


# ── Ponto de entrada público ──────────────────────────────────────────────────

def render_question_manager(conn) -> None:
    """
    Tela principal do gerenciador de questões.
    Chamada pelo app.py quando app_mode == 'questoes'.
    """
    st.markdown(
        "<h2 style='font-family:Inter,sans-serif;'>❓ Banco de Questões</h2>",
        unsafe_allow_html=True,
    )

    # Botão voltar
    if st.button("← Voltar aos documentos", key="q_back"):
        st.session_state["app_mode"] = "documentos"
        st.session_state.pop("editing_questao_id", None)
        st.session_state.pop("show_nova_questao", None)
        st.rerun()

    st.divider()

    editing_id = st.session_state.get("editing_questao_id")
    show_nova  = st.session_state.get("show_nova_questao", False)

    # ── Modo edição ───────────────────────────────────────────────
    if editing_id:
        q_row = fetchone(
            conn,
            """SELECT id, banca, ano, cargo, materia, tipo, enunciado,
                      alternativa_a, alternativa_b, alternativa_c,
                      alternativa_d, alternativa_e, gabarito,
                      comentario, dificuldade, bloco_origem_id
               FROM questoes WHERE id=?""",
            (editing_id,),
        )
        if q_row:
            _render_form(conn, dict(q_row))
        else:
            st.error("Questão não encontrada.")
            st.session_state.pop("editing_questao_id", None)
        return

    # ── Nova questão ─────────────────────────────────────────────
    if show_nova:
        _render_form(conn)
        return

    # ── Lista ─────────────────────────────────────────────────────
    col_title, col_btn = st.columns([5, 2])
    with col_btn:
        if st.button("➕ Nova questão", type="primary", use_container_width=True,
                     key="qnova_btn"):
            st.session_state["show_nova_questao"] = True
            st.rerun()

    _render_lista(conn)
