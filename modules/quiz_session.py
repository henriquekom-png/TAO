"""
modules/quiz_session.py
Sprint 10 — Ambiente de testes / sessão de quizzes.

Fluxo:
  1. Configuração: filtros (matéria, banca, dificuldade, tipo, nº questões)
  2. Sessão: apresenta uma questão por vez; usuário responde; vê gabarito comentado
  3. Resultado: % acerto, breakdown, integração FSRS nos blocos vinculados

Session state keys utilizadas:
  quiz_active      : bool — sessão em andamento
  quiz_questions   : list[dict] — questões carregadas
  quiz_idx         : int — índice atual
  quiz_results     : list[dict] — {questao_id, acertou, bloco_origem_id}
  quiz_answered    : bool — se a questão atual já foi respondida
  quiz_answer_sel  : str — resposta selecionada pelo usuário
"""

from __future__ import annotations

import random
import streamlit as st
from database.db_connection import fetchall, execute
from modules.fsrs_manager import schedule_review, RATING_LABELS
from modules.quiz_ai_review import clear_quiz_ai_state, render_ai_setup_section

# ── Helpers ───────────────────────────────────────────────────────────────────

_DIFICULDADE_ICON = {"facil": "⚪", "media": "🟡", "dificil": "🔴"}


def _load_questions(conn, materia: str, banca: str, dificuldade: str,
                    tipo: str, n: int) -> list[dict]:
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
    if tipo != "todos":
        filters.append("tipo = ?")
        params.append(tipo)

    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    rows = fetchall(
        conn,
        f"""SELECT id, materia, tipo, enunciado,
                   alternativa_a, alternativa_b, alternativa_c,
                   alternativa_d, alternativa_e,
                   gabarito, comentario, dificuldade, bloco_origem_id
            FROM questoes {where}
            ORDER BY RANDOM()
            LIMIT ?""",
        tuple(params) + (n,),
    )
    questions = []
    for r in rows:
        q = dict(r)
        if q["tipo"] == "combinacao_itens":
            itens = fetchall(
                conn,
                "SELECT numero, enunciado, correto FROM questao_itens "
                "WHERE questao_id=? ORDER BY ordem",
                (q["id"],),
            )
            q["itens"] = [dict(it) for it in itens]
        else:
            q["itens"] = []
        questions.append(q)
    return questions


def _salvar_resultado(conn, questao_id: int, acertou: bool) -> None:
    execute(
        conn,
        "INSERT INTO quiz_resultados (questao_id, acertou) VALUES (?, ?)",
        (questao_id, bool(acertou)),
    )


def _atualizar_fsrs(conn, bloco_id: int, acertou: bool) -> None:
    """Atualiza FSRS do bloco vinculado com base no acerto/erro."""
    from database.db_connection import fetchone
    row = fetchone(
        conn,
        "SELECT stability, difficulty, COALESCE(fsrs_state,0) AS fsrs_state, last_review "
        "FROM blocos WHERE id=?",
        (bloco_id,),
    )
    if not row:
        return
    rating_str = "good" if acertou else "again"
    result = schedule_review(dict(row), rating_str)
    execute(
        conn,
        """UPDATE blocos
           SET revisado=TRUE, last_review=?, next_review=?,
               stability=?, difficulty=?, fsrs_state=?, reps=reps+1
           WHERE id=?""",
        (result["last_review"], result["next_review"],
         result["stability"], result["difficulty"], result["fsrs_state"],
         bloco_id),
    )


# ── Telas ─────────────────────────────────────────────────────────────────────

def _render_config(conn) -> None:
    """Tela de configuração da sessão de estudo."""
    st.markdown(
        "<h2 style='font-family:Inter,sans-serif;'>🧪 Sessão de Estudo</h2>",
        unsafe_allow_html=True,
    )

    if st.button("← Voltar aos documentos", key="quiz_back_config"):
        st.session_state["app_mode"] = "documentos"
        st.rerun()

    st.divider()

    # Verifica se há questões cadastradas (revisão IA funciona mesmo com banco vazio)
    total = fetchall(conn, "SELECT COUNT(*) AS n FROM questoes", ())
    total_n = total[0]["n"] if total else 0
    if total_n == 0:
        st.warning(
            "⚠️ Nenhuma questão cadastrada no banco.  \n"
            "Usa a **revisão rápida com IA** abaixo ou adiciona questões em **❓ Banco de Questões**."
        )
        render_ai_setup_section()
        return

    st.markdown(f"**{total_n} questão(ões) disponíveis no banco.**")
    st.markdown("### Configurar sessão")

    c1, c2 = st.columns(2)
    with c1:
        materia = st.text_input(
            "🔍 Filtrar por matéria",
            key="quiz_cfg_mat",
            placeholder="Ex.: Direito Constitucional  (deixe vazio = todas)",
        )
    with c2:
        bancas_disp = ["(todas)"] + sorted({
            r["banca"] for r in fetchall(conn, "SELECT DISTINCT banca FROM questoes WHERE banca IS NOT NULL", ())
        })
        banca_sel = st.selectbox("Banca", bancas_disp, key="quiz_cfg_banca")
        banca = "" if banca_sel == "(todas)" else banca_sel

    c3, c4, c5 = st.columns(3)
    with c3:
        dif_opts = ["(todas)", "facil", "media", "dificil"]
        dif_sel  = st.selectbox(
            "Dificuldade", dif_opts,
            format_func=lambda x: "(todas)" if x == "(todas)" else
                        _DIFICULDADE_ICON[x] + " " + x.capitalize(),
            key="quiz_cfg_dif",
        )
        dificuldade = "" if dif_sel == "(todas)" else dif_sel

    with c4:
        tipo_opts = {"todos": "Todos", "multipla_escolha": "Múltipla escolha",
                     "certo_errado": "Certo / Errado"}
        tipo = st.selectbox(
            "Tipo", list(tipo_opts.keys()),
            format_func=lambda x: tipo_opts[x],
            key="quiz_cfg_tipo",
        )

    with c5:
        n_questoes = st.number_input(
            "Número de questões", min_value=1, max_value=100,
            value=10, step=1, key="quiz_cfg_n",
        )

    st.markdown("---")
    if st.button("▶ Iniciar sessão", type="primary",
                 use_container_width=True, key="quiz_start"):
        questoes = _load_questions(conn, materia, banca, dificuldade,
                                   tipo, int(n_questoes))
        if not questoes:
            st.error("Nenhuma questão encontrada com esses filtros.")
            return
        clear_quiz_ai_state()
        st.session_state["quiz_active"]     = True
        st.session_state["quiz_questions"]  = questoes
        st.session_state["quiz_idx"]        = 0
        st.session_state["quiz_results"]    = []
        st.session_state["quiz_answered"]   = False
        st.session_state["quiz_answer_sel"] = None
        st.rerun()

    render_ai_setup_section()


def _render_question(conn) -> None:
    """Renderiza a questão atual."""
    questions = st.session_state["quiz_questions"]
    idx       = st.session_state["quiz_idx"]
    total     = len(questions)
    q         = questions[idx]
    answered  = st.session_state.get("quiz_answered", False)
    sel       = st.session_state.get("quiz_answer_sel")

    # ── Cabeçalho ─────────────────────────────────────────────────
    st.markdown(
        f"<h2 style='font-family:Inter,sans-serif;'>🧪 Questão {idx+1} de {total}</h2>",
        unsafe_allow_html=True,
    )

    # Barra de progresso
    st.progress((idx) / total)

    col_meta, col_exit = st.columns([5, 1])
    with col_meta:
        dif = _DIFICULDADE_ICON.get(q["dificuldade"], "")
        st.caption(
            f"{dif} {q['dificuldade'].capitalize()} · {q['materia']}"
        )
    with col_exit:
        if st.button("✕ Encerrar", key="quiz_abort", use_container_width=True):
            _encerrar_sessao()
            st.rerun()

    st.divider()

    # ── Enunciado ─────────────────────────────────────────────────
    with st.container(border=True):
        st.markdown(q["enunciado"])

    # ── Itens romanos (combinacao_itens) ─────────────────────────
    if q["tipo"] == "combinacao_itens" and q.get("itens"):
        with st.container(border=True):
            for it in q["itens"]:
                # Antes de responder: sem indicação de correto/errado
                # Depois de responder: mostra ✅/❌ se marcado no cadastro
                if answered and it.get("correto") is not None:
                    icon = "✅" if it["correto"] else "❌"
                    st.markdown(f"{icon} **{it['numero']})** {it['enunciado']}")
                else:
                    st.markdown(f"**{it['numero']})** {it['enunciado']}")

    # ── Alternativas / Resposta ───────────────────────────────────
    if q["tipo"] in ("multipla_escolha", "combinacao_itens"):
        letras = [l for l in "ABCDE" if q.get(f"alternativa_{l.lower()}")]

        if not answered:
            for letra in letras:
                alt_txt = q[f"alternativa_{letra.lower()}"]
                if st.button(
                    f"**{letra})** {alt_txt}",
                    key=f"quiz_alt_{idx}_{letra}",
                    use_container_width=True,
                ):
                    st.session_state["quiz_answer_sel"] = letra
                    st.session_state["quiz_answered"]   = True
                    st.rerun()
        else:
            gabarito = q["gabarito"]
            for letra in letras:
                alt_txt = q[f"alternativa_{letra.lower()}"]
                if letra == gabarito:
                    st.success(f"✅ **{letra})** {alt_txt}")
                elif letra == sel and sel != gabarito:
                    st.error(f"❌ **{letra})** {alt_txt}  ← sua resposta")
                else:
                    st.markdown(f"**{letra})** {alt_txt}")

    elif q["tipo"] == "certo_errado":  # certo_errado
        if not answered:
            cc, ce = st.columns(2)
            with cc:
                if st.button("✅ Certo", key=f"quiz_certo_{idx}",
                             use_container_width=True):
                    st.session_state["quiz_answer_sel"] = "C"
                    st.session_state["quiz_answered"]   = True
                    st.rerun()
            with ce:
                if st.button("❌ Errado", key=f"quiz_errado_{idx}",
                             use_container_width=True):
                    st.session_state["quiz_answer_sel"] = "E"
                    st.session_state["quiz_answered"]   = True
                    st.rerun()
        else:
            gabarito = q["gabarito"]
            gab_txt  = "✅ Certo" if gabarito == "C" else "❌ Errado"
            sel_txt  = "✅ Certo" if sel == "C" else "❌ Errado"
            if sel == gabarito:
                st.success(f"Gabarito: **{gab_txt}** — Você acertou!")
            else:
                st.error(
                    f"Você respondeu **{sel_txt}**, mas o gabarito é **{gab_txt}**."
                )

    # ── Feedback após responder ───────────────────────────────────
    if answered:
        acertou = (sel == q["gabarito"])

        if q.get("comentario"):
            with st.expander("💬 Ver gabarito comentado", expanded=True):
                st.markdown(q["comentario"])

        # Registra o resultado (somente na primeira vez)
        results = st.session_state["quiz_results"]
        if len(results) <= idx:
            _salvar_resultado(conn, q["id"], acertou)
            if q.get("bloco_origem_id"):
                _atualizar_fsrs(conn, q["bloco_origem_id"], acertou)
            results.append({
                "questao_id":      q["id"],
                "materia":         q["materia"],
                "dificuldade":     q["dificuldade"],
                "acertou":         acertou,
                "bloco_origem_id": q.get("bloco_origem_id"),
            })

        st.divider()
        if idx + 1 < total:
            if st.button("Próxima questão →", type="primary",
                         use_container_width=True, key=f"quiz_prox_{idx}"):
                st.session_state["quiz_idx"]        = idx + 1
                st.session_state["quiz_answered"]   = False
                st.session_state["quiz_answer_sel"] = None
                st.rerun()
        else:
            if st.button("📊 Ver resultado final", type="primary",
                         use_container_width=True, key="quiz_finalizar"):
                st.session_state["quiz_active"] = False
                st.rerun()


def _render_results() -> None:
    """Tela de resultados da sessão."""
    results   = st.session_state.get("quiz_results", [])
    questions = st.session_state.get("quiz_questions", [])
    total     = len(results)
    acertos   = sum(1 for r in results if r["acertou"])
    pct       = round(acertos / total * 100) if total else 0

    st.markdown(
        "<h2 style='font-family:Inter,sans-serif;'>📊 Resultado da Sessão</h2>",
        unsafe_allow_html=True,
    )

    # ── Placar ────────────────────────────────────────────────────
    c1, c2, c3 = st.columns(3)
    c1.metric("Total", total)
    c2.metric("Acertos", acertos)
    c3.metric("Aproveitamento", f"{pct}%")
    st.progress(pct / 100)

    # Mensagem motivacional
    if pct >= 70:
        st.success("🎉 Ótimo desempenho! Continue assim.")
    elif pct >= 50:
        st.warning("📚 Bom começo — revise os erros e tente novamente.")
    else:
        st.error("💪 Precisamos estudar mais. Revise o gabarito comentado!")

    st.divider()

    # ── Breakdown por dificuldade ─────────────────────────────────
    st.markdown("#### Por dificuldade")
    for dif in ["facil", "media", "dificil"]:
        sub = [r for r in results if r["dificuldade"] == dif]
        if sub:
            ac  = sum(1 for r in sub if r["acertou"])
            pct_d = round(ac / len(sub) * 100)
            st.markdown(
                f"{_DIFICULDADE_ICON[dif]} **{dif.capitalize()}**: "
                f"{ac}/{len(sub)} ({pct_d}%)"
            )

    # ── Questões erradas ──────────────────────────────────────────
    erros = [r for r in results if not r["acertou"]]
    if erros:
        st.divider()
        st.markdown(f"#### ❌ {len(erros)} questão(ões) errada(s)")
        for i, r in enumerate(erros):
            q = next((x for x in questions if x["id"] == r["questao_id"]), None)
            if q:
                with st.expander(f"Questão errada: {q['materia']}", expanded=False):
                    st.markdown(q["enunciado"])
                    gab = q["gabarito"]
                    if q["tipo"] == "multipla_escolha":
                        alt_txt = q.get(f"alternativa_{gab.lower()}", "")
                        st.success(f"✅ Gabarito: **{gab})** {alt_txt}")
                    else:
                        st.success(f"✅ Gabarito: {'Certo' if gab=='C' else 'Errado'}")
                    if q.get("comentario"):
                        st.markdown(q["comentario"])

    # ── FSRS ─────────────────────────────────────────────────────
    blocos_atualizados = sum(1 for r in results if r.get("bloco_origem_id"))
    if blocos_atualizados:
        st.info(
            f"🔄 **{blocos_atualizados} bloco(s)** tiveram o agendamento de "
            "revisão (FSRS) atualizado automaticamente."
        )

    st.divider()
    c_rep, c_vol = st.columns(2)
    with c_rep:
        if st.button("🔁 Nova sessão", use_container_width=True, key="quiz_replay"):
            _encerrar_sessao()
            st.rerun()
    with c_vol:
        if st.button("← Voltar aos documentos", use_container_width=True,
                     key="quiz_back_results"):
            _encerrar_sessao()
            st.session_state["app_mode"] = "documentos"
            st.rerun()


def _encerrar_sessao() -> None:
    for k in ["quiz_active", "quiz_questions", "quiz_idx",
              "quiz_results", "quiz_answered", "quiz_answer_sel"]:
        st.session_state.pop(k, None)


# ── Ponto de entrada público ──────────────────────────────────────────────────

def render_quiz(conn) -> None:
    """
    Entrada principal chamada pelo app.py quando app_mode == 'quiz'.
    Roteia entre: config → questão → resultado.
    """
    if st.session_state.get("quiz_ai_session"):
        from modules.quiz_ai_review import render_ai_review_session

        render_ai_review_session()
        return

    active    = st.session_state.get("quiz_active", False)
    questions = st.session_state.get("quiz_questions", [])
    idx       = st.session_state.get("quiz_idx", 0)

    if not active:
        # Sessão encerrada ou não iniciada
        if questions and idx >= len(questions) - 1 and st.session_state.get("quiz_results"):
            _render_results()
        else:
            _render_config(conn)
    else:
        _render_question(conn)
