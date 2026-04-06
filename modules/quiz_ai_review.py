"""
modules/quiz_ai_review.py
Revisão rápida com IA — questões temporárias (sem persistência em questoes/quiz_resultados).
"""

from __future__ import annotations

import json
import re
from typing import Any

import streamlit as st

from modules.chatbot import get_chat_llm_config

MAX_QUESTOES = 10

_SYSTEM_JSON = (
    "És um assistente pedagógico. Respondes SEMPRE em português do Brasil. "
    "Quando pedido JSON, devolves APENAS um único objeto JSON válido, sem markdown, "
    "sem texto antes ou depois."
)

_TIPOS_LABEL = {
    "certo_errado": "Certo / Errado",
    "vf_itens": "Itens verdadeiros e falsos",
    "multipla_escolha": "Múltipla escolha",
    "lacunas": "Preencher lacunas",
}


def _extract_json_object(text: str) -> dict[str, Any] | None:
    s = text.strip()
    try:
        data = json.loads(s)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        pass
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", s, re.DOTALL)
    if m:
        try:
            data = json.loads(m.group(1))
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            pass
    start = s.find("{")
    end = s.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(s[start : end + 1])
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def _call_gemini(api_key: str, model_name: str, prompt: str) -> str:
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(model_name, system_instruction=_SYSTEM_JSON)
    resp = model.generate_content(
        prompt,
        generation_config={"max_output_tokens": 8192, "temperature": 0.35},
    )
    return (resp.text or "").strip()


def _call_openai(api_key: str, model_name: str, prompt: str) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": _SYSTEM_JSON},
            {"role": "user", "content": prompt},
        ],
        max_tokens=8192,
        temperature=0.35,
    )
    return (response.choices[0].message.content or "").strip()


def _call_llm(provider: str, api_key: str, model_name: str, prompt: str) -> str:
    if provider == "gemini":
        return _call_gemini(api_key, model_name, prompt)
    return _call_openai(api_key, model_name, prompt)


def _build_generation_prompt(
    n: int, tipos_descricao: str, contexto: str,
) -> str:
    schema = """
Devolve um JSON com esta forma exata (chave de topo "questoes", array):
{
  "questoes": [
    {
      "id": 1,
      "tipo": "certo_errado",
      "enunciado": "texto da afirmação",
      "opcoes": null,
      "itens_vf": null,
      "lacunas_esperadas": null,
      "gabarito": "C"
    },
    {
      "id": 2,
      "tipo": "multipla_escolha",
      "enunciado": "pergunta",
      "opcoes": {"A": "...", "B": "...", "C": "...", "D": "..."},
      "itens_vf": null,
      "lacunas_esperadas": null,
      "gabarito": "B"
    },
    {
      "id": 3,
      "tipo": "vf_itens",
      "enunciado": "instrução curta",
      "opcoes": null,
      "itens_vf": [{"texto": "afirmação 1", "correto": true}, {"texto": "afirmação 2", "correto": false}],
      "lacunas_esperadas": null,
      "gabarito": null
    },
    {
      "id": 4,
      "tipo": "lacunas",
      "enunciado": "texto com ____ onde falta cada palavra",
      "opcoes": null,
      "itens_vf": null,
      "lacunas_esperadas": ["resposta1", "resposta2"],
      "gabarito": null
    }
  ]
}

Regras:
- "tipo" só pode ser: certo_errado | multipla_escolha | vf_itens | lacunas
- certo_errado: gabarito "C" (certo) ou "E" (errado)
- multipla_escolha: gabarito letra A-D (ou E se houver 5 opções)
- vf_itens: pelo menos 3 itens; correto = true se a afirmação é verdadeira
- lacunas: lacunas_esperadas na mesma ordem dos buracos ____ no enunciado
- ids inteiros sequenciais a partir de 1
"""
    return f"""Gera exatamente {n} questões de estudo para revisão rápida.

Tipos a utilizar (distribui entre elas): {tipos_descricao}

Contexto / matéria pedida pelo aluno:
---
{contexto}
---

{schema}

Gera exatamente {n} objetos no array "questoes". JSON apenas."""


def _normalize_questoes(raw: list[Any], max_n: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    allowed = {"certo_errado", "multipla_escolha", "vf_itens", "lacunas"}
    for i, item in enumerate(raw[:max_n]):
        if not isinstance(item, dict):
            continue
        tipo = item.get("tipo")
        if tipo not in allowed:
            continue
        q = {
            "id": item.get("id", i + 1),
            "tipo": tipo,
            "enunciado": str(item.get("enunciado", "")).strip(),
            "opcoes": item.get("opcoes"),
            "itens_vf": item.get("itens_vf"),
            "lacunas_esperadas": item.get("lacunas_esperadas"),
            "gabarito": item.get("gabarito"),
        }
        if not q["enunciado"]:
            continue
        out.append(q)
    return out


def _parse_generation_response(text: str, max_n: int) -> tuple[list[dict[str, Any]] | None, str | None]:
    data = _extract_json_object(text)
    if not data:
        return None, "Não foi possível ler o JSON devolvido pelo modelo. Tente gerar novamente."
    questoes = data.get("questoes")
    if not isinstance(questoes, list):
        return None, 'O JSON deve conter a chave "questoes" (array).'
    norm = _normalize_questoes(questoes, max_n)
    if not norm:
        return None, "Nenhuma questão válida após validação. Tente de novo."
    return norm, None


def _build_grade_prompt(questao: dict[str, Any], resposta_aluno: Any) -> str:
    qjson = json.dumps(questao, ensure_ascii=False)
    rjson = json.dumps(resposta_aluno, ensure_ascii=False)
    return f"""Avalia a resposta do aluno à questão abaixo.

QUESTÃO (JSON):
{qjson}

RESPOSTA DO ALUNO (JSON — pode ser string, lista ou objeto):
{rjson}

Devolve APENAS um JSON:
{{
  "acertou": true ou false,
  "resposta_correta": "texto claro com o gabarito esperado",
  "feedback": "explicação breve em português do Brasil"
}}

Se a questão tem várias partes (V/F, lacunas), acertou só é true se tudo estiver correto.
JSON apenas, sem markdown."""


def _parse_grade_response(text: str) -> tuple[bool | None, str, str]:
    data = _extract_json_object(text)
    if not data:
        return None, "", "Resposta da IA em formato inválido. Tente verificar novamente."
    ac = data.get("acertou")
    acertou = bool(ac) if isinstance(ac, bool) else None
    rc = str(data.get("resposta_correta", "") or "").strip()
    fb = str(data.get("feedback", "") or "").strip()
    return acertou, rc, fb


def _tipos_para_prompt(ce: bool, vf: bool, me: bool, lac: bool, rnd: bool) -> str:
    if rnd:
        return ", ".join(_TIPOS_LABEL[k] for k in _TIPOS_LABEL)
    parts = []
    if ce:
        parts.append(_TIPOS_LABEL["certo_errado"])
    if vf:
        parts.append(_TIPOS_LABEL["vf_itens"])
    if me:
        parts.append(_TIPOS_LABEL["multipla_escolha"])
    if lac:
        parts.append(_TIPOS_LABEL["lacunas"])
    return ", ".join(parts) if parts else ""


def clear_quiz_ai_state() -> None:
    for k in (
        "quiz_ai_session",
        "quiz_ai_questions",
        "quiz_ai_feedback",
        "quiz_ai_show_setup",
    ):
        st.session_state.pop(k, None)


def render_ai_setup_section() -> None:
    """Secção abaixo de Iniciar Sessão: botão + formulário + gerar."""
    if st.button(
        "✨ Gerar Questões com IA - Revisão Rápida",
        use_container_width=True,
        key="quiz_ai_open_btn",
    ):
        st.session_state["quiz_ai_show_setup"] = True
        st.rerun()

    if not st.session_state.get("quiz_ai_show_setup"):
        return

    st.markdown("### ✨ Revisão rápida com IA")
    st.caption("Questões temporárias — não são guardadas no banco de questões.")

    api_key, provider, model_name = get_chat_llm_config()
    if not api_key:
        st.warning(
            "Configura uma API key no **Assistente de Revisão** (sidebar) ou em "
            "**Secrets** (`GOOGLE_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY`)."
        )

    c1, c2 = st.columns(2)
    with c1:
        st.markdown("**Tipos de exercício**")
        ce = st.checkbox("Certo / Errado", key="quiz_ai_t_ce")
        vf = st.checkbox("Itens verdadeiros e falsos", key="quiz_ai_t_vf")
        me = st.checkbox("Múltipla escolha", key="quiz_ai_t_me")
        lac = st.checkbox("Preencher lacunas", key="quiz_ai_t_lac")
        rnd = st.checkbox("Aleatório (mistura dos tipos acima)", key="quiz_ai_t_rnd")
    with c2:
        n_q = st.number_input(
            "Quantidade de questões",
            min_value=1,
            max_value=MAX_QUESTOES,
            value=min(5, MAX_QUESTOES),
            step=1,
            key="quiz_ai_n",
        )
        ctx = st.text_area(
            "Contexto — o que queres treinar?",
            height=140,
            key="quiz_ai_ctx",
            placeholder="Ex.: Art. 7º da CF, prazos da CLT, competência do MPT…",
        )

    tipos_txt = _tipos_para_prompt(ce, vf, me, lac, rnd)
    if not tipos_txt:
        st.info("Marca pelo menos um tipo, ou **Aleatório**.")

    n_final = max(1, min(int(n_q), MAX_QUESTOES))

    col_g, col_x = st.columns(2)
    with col_g:
        gerar = st.button(
            "Gerar questões",
            type="primary",
            use_container_width=True,
            key="quiz_ai_generate",
            disabled=not api_key or not tipos_txt or not (ctx or "").strip(),
        )
    with col_x:
        if st.button("Fechar", use_container_width=True, key="quiz_ai_close_setup"):
            st.session_state["quiz_ai_show_setup"] = False
            st.rerun()

    if gerar and api_key and tipos_txt and (ctx or "").strip():
        prompt = _build_generation_prompt(n_final, tipos_txt, ctx.strip())
        with st.spinner("A gerar questões com IA…"):
            try:
                raw = _call_llm(provider, api_key, model_name, prompt)
            except Exception as exc:
                st.error(f"Erro ao chamar a API: {exc}")
                return
        questoes, err = _parse_generation_response(raw, n_final)
        if err:
            st.warning(f"{err}")
            return
        st.session_state["quiz_ai_questions"] = questoes
        st.session_state["quiz_ai_session"] = True
        st.session_state["quiz_ai_feedback"] = {}
        st.session_state["quiz_ai_show_setup"] = False
        st.rerun()


def _collect_answer_ui(q: dict[str, Any], idx: int) -> Any | None:
    tipo = q["tipo"]
    prefix = f"quiz_ai_a_{idx}"

    if tipo == "certo_errado":
        v = st.radio(
            "A tua resposta",
            options=["C", "E"],
            format_func=lambda x: "Certo" if x == "C" else "Errado",
            horizontal=True,
            key=f"{prefix}_ce",
        )
        return v

    if tipo == "multipla_escolha":
        op = q.get("opcoes") or {}
        if not isinstance(op, dict) or not op:
            st.caption("Opções em falta nesta questão.")
            return None
        letters = sorted((str(k) for k in op.keys()), key=lambda x: (len(x), x))
        choice = st.radio(
            "Escolhe a alternativa",
            options=letters,
            format_func=lambda let: f"{let}) {op.get(let, '')}",
            key=f"{prefix}_me",
        )
        return choice

    if tipo == "vf_itens":
        itens = q.get("itens_vf") or []
        if not isinstance(itens, list):
            return None
        respostas = []
        for j, it in enumerate(itens):
            if not isinstance(it, dict):
                continue
            txt = str(it.get("texto", ""))[:500]
            v = st.radio(
                f"Item {j + 1}: {txt}",
                options=["V", "F"],
                format_func=lambda x: "Verdadeiro" if x == "V" else "Falso",
                horizontal=True,
                key=f"{prefix}_vf_{j}",
            )
            respostas.append(v == "V")
        return respostas if respostas else None

    if tipo == "lacunas":
        esp = q.get("lacunas_esperadas")
        if not isinstance(esp, list):
            esp = []
        n = len(esp) if esp else max(1, q["enunciado"].count("____"))
        vals = []
        for j in range(n):
            vals.append(
                st.text_input(f"Lacuna {j + 1}", key=f"{prefix}_lac_{j}", label_visibility="visible")
            )
        return vals

    return None


def render_ai_review_session() -> None:
    """Ecrã de prática com questões geradas (só memória)."""
    questoes: list[dict[str, Any]] = st.session_state.get("quiz_ai_questions") or []
    feedback: dict[str, Any] = st.session_state.setdefault("quiz_ai_feedback", {})

    st.markdown(
        "<h2 style='font-family:Inter,sans-serif;'>✨ Revisão rápida com IA</h2>",
        unsafe_allow_html=True,
    )

    if st.button("← Voltar à configuração", key="quiz_ai_back_cfg"):
        clear_quiz_ai_state()
        st.rerun()

    api_key, provider, model_name = get_chat_llm_config()
    if not api_key:
        st.error("API key em falta. Configura no Assistente ou nos secrets.")
        return

    for idx, q in enumerate(questoes):
        st.divider()
        st.markdown(f"**Questão {idx + 1} de {len(questoes)}** · `{q.get('tipo', '')}`")
        st.markdown(q.get("enunciado", ""))

        fid = str(q.get("id", idx))
        prev = feedback.get(fid)

        ans = _collect_answer_ui(q, idx)

        if st.button("Verificar", key=f"quiz_ai_verify_{idx}"):
            if ans is None and q["tipo"] != "lacunas":
                st.warning("Preenche a resposta antes de verificar.")
            elif q["tipo"] == "lacunas" and (
                not isinstance(ans, list) or not any(str(x).strip() for x in ans)
            ):
                st.warning("Preenche as lacunas antes de verificar.")
            else:
                gprompt = _build_grade_prompt(q, ans)
                with st.spinner("A avaliar com IA…"):
                    try:
                        graw = _call_llm(provider, api_key, model_name, gprompt)
                    except Exception as exc:
                        st.error(f"Erro na API: {exc}")
                        graw = ""
                acertou, rc, fb = _parse_grade_response(graw)
                feedback[fid] = {
                    "acertou": acertou,
                    "resposta_correta": rc,
                    "feedback": fb,
                    "raw_error": acertou is None,
                }
                st.session_state["quiz_ai_feedback"] = feedback
                st.rerun()

        if prev:
            if prev.get("raw_error"):
                st.warning(prev.get("feedback") or "Erro ao avaliar.")
            elif prev.get("acertou") is True:
                st.success("**Acertaste.**")
            elif prev.get("acertou") is False:
                st.error("**Erraste.**")
            else:
                st.info("Resultado indeterminado.")
            if prev.get("resposta_correta"):
                st.markdown(f"**Resposta correta / gabarito:** {prev['resposta_correta']}")
            if prev.get("feedback") and not prev.get("raw_error"):
                st.caption(prev["feedback"])

    st.divider()
    if st.button("Encerrar revisão IA", use_container_width=True, key="quiz_ai_end"):
        clear_quiz_ai_state()
        st.rerun()
