"""
modules/chatbot.py
Sprint 7 — Assistente de Revisão TAO (RAG).

Pipeline:
  1. Recebe a pergunta do usuário.
  2. Busca contexto: ChromaDB (material de apoio) + FTS (blocos) + anotações
     ligadas aos blocos encontrados (texto/tabela/fluxograma).
  3. Monta prompt com contexto + histórico de conversa.
  4. Chama LLM (Google Gemini ou OpenAI).
  5. Exibe resposta com expandable de fontes.

Session state keys usados:
  - chat_history     : list[dict]  — mensagens {role, content, sources?}
  - chat_provider    : str         — "gemini" | "openai"
  - chat_api_key     : str         — API key ativa
"""

import re
import time
import streamlit as st
from database.db_connection import fetchall

# ── Prompt do sistema ─────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """
Você é o Assistente de Revisão TAO — especialista em Direito do Trabalho e
concursos públicos do MPT (Ministério Público do Trabalho).

Regras:
- Responda SEMPRE em português do Brasil.
- Baseie suas respostas no contexto fornecido pelo material indexado.
- Trechos marcados como anotações do utilizador (§ Notas / § Fonte do utilizador)
  refinam ou explicam os blocos; utilize-os quando forem pertinentes à pergunta,
  distinguindo texto normativo das suas próprias sínteses quando necessário.
- Se não encontrar a informação, diga: "Não encontrei essa informação no material indexado."
- Ao citar artigos de lei, mencione número e dispositivo.
- Seja conciso, preciso e use Markdown quando útil.
""".strip()


# Modelos Gemini (google.generativeai — IDs conforme AI Studio / documentação Google)
_GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gemma-3-12b",
    "gemma-3-27b",
]

# Modelos OpenAI disponíveis
_OPENAI_MODELS = [
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-3.5-turbo",
]


def get_chat_llm_config() -> tuple[str, str, str]:
    """
    (api_key, provider, model_name) para reutilização fora do painel do chat.
    Ordem: session_state → secrets (como no expander do assistente).
    """
    api_key = (st.session_state.get("chat_api_key") or "").strip()
    provider = st.session_state.get("chat_provider", "gemini")
    default_model = _GEMINI_MODELS[0] if provider == "gemini" else _OPENAI_MODELS[0]
    model_name = st.session_state.get("chat_model", default_model)
    if not api_key:
        try:
            if provider == "gemini":
                api_key = (
                    st.secrets.get("GOOGLE_API_KEY", "")
                    or st.secrets.get("GEMINI_API_KEY", "")
                ).strip()
            else:
                api_key = (st.secrets.get("OPENAI_API_KEY", "") or "").strip()
        except Exception:
            pass
    return api_key, provider, model_name


# ── Verificação de dependências ───────────────────────────────────────────────

def _deps() -> dict:
    ok: dict[str, bool] = {}
    try:
        import google.generativeai  # noqa
        ok["gemini"] = True
    except ImportError:
        ok["gemini"] = False
    try:
        import openai  # noqa
        ok["openai"] = True
    except ImportError:
        ok["openai"] = False
    try:
        from sentence_transformers import SentenceTransformer  # noqa
        ok["embeddings"] = True
    except ImportError:
        ok["embeddings"] = False
    return ok


# ── RAG: busca de contexto ────────────────────────────────────────────────────

def _fetch_anotacoes_por_blocos(conn, bloco_ids: list[int]) -> dict[int, list]:
    """
    Todas as anotações (texto/tabela/fluxograma) dos blocos indicados,
    na ordem guardada na base. Portais são omitidos (conteúdo é referência).
    """
    if not bloco_ids:
        return {}
    placeholders = ",".join(["?"] * len(bloco_ids))
    sql = f"""
        SELECT a.id AS anotacao_id, a.conteudo, a.tipo, a.bloco_id,
               b.identificador, b.conteudo AS bloco_conteudo,
               d.titulo AS doc_titulo
        FROM anotacoes a
        JOIN blocos b ON a.bloco_id = b.id
        JOIN documentos d ON b.documento_id = d.id
        WHERE a.bloco_id IN ({placeholders})
          AND a.tipo IN ('texto', 'tabela', 'fluxograma')
          AND TRIM(COALESCE(a.conteudo, '')) <> ''
        ORDER BY a.bloco_id, a.ordem
    """
    rows = fetchall(conn, sql, tuple(bloco_ids))
    out: dict[int, list] = {}
    for row in rows:
        bid = row["bloco_id"]
        out.setdefault(bid, []).append(row)
    return out


def _rag_search(conn, query: str) -> list[dict]:
    """
    Busca contexto relevante em:
      1. ChromaDB — material de apoio indexado.
      2. FTS — blocos atômicos; em seguida injeta todas as notas desses blocos.
      3. LIKE — anotações cujo texto coincide com termos da pergunta (complemento).
    """
    results: list[dict] = []
    seen_anot_ids: set[int] = set()

    # ── 1. ChromaDB ──────────────────────────────────────────────
    try:
        from vector_store.chroma_client import get_collection
        from modules.material_upload import _get_encoder
        encoder = _get_encoder()
        emb     = encoder.encode([query])[0].tolist()
        col     = get_collection("tao_materiais")
        if col and col.count() > 0:
            res = col.query(query_embeddings=[emb], n_results=4)
            for i, doc in enumerate(res["documents"][0]):
                meta  = res["metadatas"][0][i]
                score = 1.0 - res["distances"][0][i]
                results.append({
                    "fonte":    f"📄 {meta.get('nome', 'Material')}",
                    "conteudo": doc,
                    "score":    round(score, 3),
                    "tipo":     "material",
                })
    except Exception:
        pass

    # ── 2. SQLite FTS5 + LIKE fallback ───────────────────────────
    # Prepara termos para FTS5: cada palavra vira um termo com *
    # Ex: "força de trabalho" → '"força" OR "trabalho"'
    def _fts_query(q: str) -> str:
        words = [w.strip() for w in q.split() if len(w.strip()) >= 2]
        if not words:
            return q
        # Tenta frase exata primeiro, depois OR de termos individuais
        return f'"{q}" OR ' + " OR ".join(f'"{w}"' for w in words)

    fts_sql = """
        SELECT b.id AS bloco_id, b.conteudo, b.identificador, d.titulo AS doc_titulo
        FROM blocos_fts
        JOIN blocos     b ON blocos_fts.rowid = b.id
        JOIN documentos d ON b.documento_id   = d.id
        WHERE blocos_fts MATCH ?
        ORDER BY rank
        LIMIT 5
    """
    like_sql = """
        SELECT b.id AS bloco_id, b.conteudo, b.identificador, d.titulo AS doc_titulo
        FROM blocos b
        JOIN documentos d ON b.documento_id = d.id
        WHERE b.conteudo LIKE ?
        LIMIT 5
    """

    fts_rows = []
    try:
        fts_rows = fetchall(conn, fts_sql, (_fts_query(query),))
    except Exception:
        pass

    # Fallback LIKE se FTS não trouxe resultados
    if not fts_rows:
        try:
            main_word = max(query.split(), key=len) if query.split() else query
            fts_rows = fetchall(conn, like_sql, (f"%{main_word}%",))
        except Exception:
            pass

    bloco_ids_ord: list[int] = []
    _seen_bid: set[int] = set()
    for row in fts_rows:
        bid = row["bloco_id"]
        if bid not in _seen_bid:
            _seen_bid.add(bid)
            bloco_ids_ord.append(bid)
    anot_por_bloco = _fetch_anotacoes_por_blocos(conn, bloco_ids_ord)

    injetou_notas: set[int] = set()
    for row in fts_rows:
        bid = row["bloco_id"]
        results.append({
            "fonte":    f"📖 {row['doc_titulo']} — {row['identificador'] or ''}",
            "conteudo": row["conteudo"],
            "score":    0.75,
            "tipo":     "bloco",
        })
        if bid in injetou_notas:
            continue
        injetou_notas.add(bid)
        for ar in anot_por_bloco.get(bid, []):
            aid = ar["anotacao_id"]
            seen_anot_ids.add(aid)
            tipo = ar["tipo"]
            icon = "📊" if tipo == "tabela" else ("🔀" if tipo == "fluxograma" else "📝")
            results.append({
                "fonte": (
                    f"{icon} § Notas — {ar['doc_titulo']} "
                    f"({ar['identificador'] or 'bloco'})"
                ),
                "conteudo": (
                    "[Referência do bloco — trecho]\n"
                    f"{(ar['bloco_conteudo'] or '')[:360]}\n\n"
                    "[Anotação do utilizador]\n"
                    f"{ar['conteudo']}"
                ),
                "score":    0.78,
                "tipo":     "anotacao",
            })

    # ── 3. Anotações de Link ──────────────────────────────────────
    # Stop words PT-BR a ignorar na busca
    _STOP = {"o","a","os","as","um","uma","de","do","da","dos","das","em","no",
             "na","nos","nas","para","por","com","que","se","e","ou","ao","à",
             "é","foi","ser","ter","tem","não","mais","já","como","isso","este",
             "esta","esse","essa","seu","sua","possui","qual","quais","quando"}

    # Palavras significativas da query (len >= 3 e não stop word)
    palavras = [
        w.strip("?!.,;:\"'()").lower()
        for w in query.split()
        if len(w.strip("?!.,;:\"'()")) >= 3
           and w.strip("?!.,;:\"'()").lower() not in _STOP
    ]

    if not palavras:
        palavras = [query[:40]]

    # Monta SQL dinâmico com OR para cada palavra significativa
    placeholders = " OR ".join(["a.conteudo LIKE ?"] * len(palavras))
    anot_sql = f"""
        SELECT a.id AS anotacao_id, a.conteudo, a.tipo,
               b.identificador, b.conteudo AS bloco_conteudo,
               d.titulo AS doc_titulo
        FROM anotacoes a
        JOIN blocos     b ON a.bloco_id     = b.id
        JOIN documentos d ON b.documento_id = d.id
        WHERE ({placeholders})
          AND a.tipo IN ('texto', 'tabela', 'fluxograma')
          AND TRIM(COALESCE(a.conteudo, '')) <> ''
        LIMIT 8
    """
    try:
        params = tuple(f"%{p}%" for p in palavras)
        anot_rows = fetchall(conn, anot_sql, params)
        for row in anot_rows:
            aid = row["anotacao_id"]
            if aid in seen_anot_ids:
                continue
            seen_anot_ids.add(aid)
            tipo = row["tipo"]
            tipo_icon = "📊" if tipo == "tabela" else ("🔀" if tipo == "fluxograma" else "📝")
            results.append({
                "fonte": (
                    f"{tipo_icon} § Notas (coincidência na pergunta) — {row['doc_titulo']} "
                    f"({row['identificador'] or 'bloco'})"
                ),
                "conteudo": (
                    "[Referência do bloco — trecho]\n"
                    f"{(row['bloco_conteudo'] or '')[:360]}\n\n"
                    "[Anotação do utilizador]\n"
                    f"{row['conteudo']}"
                ),
                "score":    0.72,
                "tipo":     "anotacao",
            })
    except Exception:
        pass

    return results


def _build_context(results: list[dict]) -> str:
    if not results:
        return "(Nenhum conteúdo relevante encontrado no material indexado.)"
    parts = [f"[{r['fonte']}]\n{r['conteudo']}" for r in results]
    return "\n\n---\n\n".join(parts)


# ── Chamadas LLM ──────────────────────────────────────────────────────────────

def _gemini_chat(api_key: str, model_name: str, history_msgs: list, user_prompt: str) -> str:
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name,
        system_instruction=_SYSTEM_PROMPT,
    )

    # Converte histórico para o formato do SDK
    gemini_hist = []
    for msg in history_msgs:
        role = "user" if msg["role"] == "user" else "model"
        gemini_hist.append({"role": role, "parts": [msg["content"]]})

    chat     = model.start_chat(history=gemini_hist)
    response = chat.send_message(user_prompt)
    return response.text


def _openai_chat(api_key: str, model_name: str, history_msgs: list, user_prompt: str) -> str:
    from openai import OpenAI
    client   = OpenAI(api_key=api_key)
    messages = [{"role": "system", "content": _SYSTEM_PROMPT}]
    for msg in history_msgs:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": user_prompt})
    response = client.chat.completions.create(
        model=model_name,
        messages=messages,
        max_tokens=1800,
    )
    return response.choices[0].message.content


def _get_answer(
    conn,
    provider: str,
    api_key: str,
    model_name: str,
    user_msg: str,
) -> tuple[str, list[dict]]:
    """Executa o pipeline RAG completo e retorna (resposta, fontes)."""
    sources  = _rag_search(conn, user_msg)
    context  = _build_context(sources)
    history  = [
        m for m in st.session_state.get("chat_history", [])
        if m["role"] in ("user", "assistant")
    ]

    full_prompt = (
        f"Contexto do material de estudo:\n\n{context}\n\n"
        f"Pergunta: {user_msg}\n\n"
        f"Responda com base no contexto acima."
    )

    max_retries = 2
    for attempt in range(max_retries + 1):
        try:
            if provider == "gemini":
                answer = _gemini_chat(api_key, model_name, history, full_prompt)
            else:
                answer = _openai_chat(api_key, model_name, history, full_prompt)
            return answer, sources

        except Exception as exc:
            err_str = str(exc)

            # ── Cota esgotada (429) ───────────────────────────────
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                # limit: 0 → cota zerada (problema de conta ou cota diária esgotada)
                has_zero_limit = bool(re.search(r"['\"]?limit['\"]?\s*:\s*0", err_str))
                if has_zero_limit:
                    answer = (
                        "🔑 **Cota zerada para este modelo.**\n\n"
                        "**Causas possíveis:**\n"
                        "- A cota diária gratuita do modelo atual foi esgotada "
                        "(renova à meia-noite, horário do Pacífico).\n"
                        "- O projeto vinculado à sua chave teve a cota redefinida para 0.\n\n"
                        "**O que testar agora:**\n"
                        "1. Na configuração acima, troque o modelo para "
                        "`gemini-2.5-flash-lite` ou `gemini-3-flash-preview` — cotas por modelo.\n"
                        "2. Se continuar falhando, crie uma **nova API key em um projeto novo** "
                        "em https://aistudio.google.com/apikey\n"
                        "3. Se nenhum modelo funcionar, habilite faturamento no projeto em "
                        "https://console.cloud.google.com/billing — "
                        "o Gemini mantém camada gratuita mesmo com billing ativo."
                    )
                    return answer, []

                # Cota temporária → retry com countdown
                retry_match = re.search(r'retryDelay.*?(\d+)s', err_str)
                wait_s = int(retry_match.group(1)) if retry_match else 15

                if attempt < max_retries:
                    placeholder = st.empty()
                    for remaining in range(wait_s, 0, -1):
                        placeholder.warning(
                            f"⏳ Limite de requisições atingido. "
                            f"Tentando novamente em **{remaining}s**… "
                            f"(tentativa {attempt + 1}/{max_retries})"
                        )
                        time.sleep(1)
                    placeholder.empty()
                    continue
                else:
                    answer = (
                        "⚠️ **Limite de requisições atingido.**\n\n"
                        "- Aguarde 1 minuto e tente novamente.\n"
                        "- Ou troque para outro modelo da lista (ex.: `gemini-2.5-flash-lite`).\n"
                        "- Monitore seu uso em: https://ai.dev/rate-limit"
                    )
                    return answer, []

            # ── Outros erros ──────────────────────────────────────
            answer = f"❌ Erro ao chamar a API: {exc}"
            return answer, []

    return "❌ Falha após múltiplas tentativas.", []


# ── Renderização ──────────────────────────────────────────────────────────────

def render_chatbot(conn) -> None:
    """Painel completo do Assistente de Revisão RAG."""
    deps = _deps()

    st.markdown(
        "<div style='font-size:1.25rem;font-weight:700;margin-bottom:0.5rem;'>"
        "🤖 Assistente de Revisão</div>",
        unsafe_allow_html=True,
    )

    # ── Configuração ─────────────────────────────────────────────
    cfg_expanded = not bool(st.session_state.get("chat_api_key"))
    with st.expander("⚙️ Configuração", expanded=cfg_expanded):
        provider = st.radio(
            "Provedor LLM:",
            options=["gemini", "openai"],
            format_func=lambda x: "Google Gemini" if x == "gemini" else "OpenAI",
            key="chat_provider",
            horizontal=True,
        )
        if provider == "gemini" and not deps["gemini"]:
            st.warning("`pip install google-genai`")
        if provider == "openai" and not deps["openai"]:
            st.warning("`pip install openai`")

        # Seletor de modelo
        model_options = _GEMINI_MODELS if provider == "gemini" else _OPENAI_MODELS
        model_name = st.selectbox(
            "Modelo:",
            options=model_options,
            key="chat_model",
            help="Lista atualizada de modelos Gemini/Gemma (AI Studio). Padrão: gemini-2.5-flash.",
        )

        # Tenta carregar do secrets automaticamente
        # Suporta tanto GOOGLE_API_KEY (padrão AI Studio) quanto GEMINI_API_KEY
        secret_key = ""
        try:
            if provider == "gemini":
                secret_key = (st.secrets.get("GOOGLE_API_KEY", "")
                              or st.secrets.get("GEMINI_API_KEY", ""))
            else:
                secret_key = st.secrets.get("OPENAI_API_KEY", "")
        except Exception:
            pass

        new_key = st.text_input(
            "API Key:",
            value=st.session_state.get("chat_api_key", secret_key),
            type="password",
            placeholder="Cole sua API Key aqui…",
            key="chat_api_key_input",
        )
        if new_key:
            st.session_state["chat_api_key"] = new_key

        rag_info = ""
        try:
            from vector_store.chroma_client import get_collection
            col = get_collection("tao_materiais")
            n   = col.count() if col else 0
            rag_info = f"📦 ChromaDB: **{n}** chunks indexados"
        except Exception:
            rag_info = "📦 ChromaDB: indisponível"
        st.caption(rag_info)

        if st.button("🗑️ Limpar conversa", key="btn_clear_chat"):
            st.session_state["chat_history"] = []
            st.rerun()

    api_key = st.session_state.get("chat_api_key", "")
    if not api_key:
        st.info("Configure sua API key acima para começar a conversa.")
        return

    # ── Histórico ─────────────────────────────────────────────────
    if "chat_history" not in st.session_state:
        st.session_state["chat_history"] = []

    for msg in st.session_state["chat_history"]:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])
            if msg.get("sources") and msg["role"] == "assistant":
                with st.expander(
                    f"📚 Fontes consultadas ({len(msg['sources'])})",
                    expanded=False,
                ):
                    for src in msg["sources"]:
                        st.markdown(
                            f"**{src['fonte']}**  \n"
                            f"<span style='font-size:0.78rem;color:#666'>"
                            f"{src['conteudo'][:220]}…</span>",
                            unsafe_allow_html=True,
                        )

    # ── Input ────────────────────────────────────────────────────
    user_input = st.chat_input(
        "Pergunte sobre o material de estudo…",
        key="chat_input_widget",
    )
    if user_input:
        st.session_state["chat_history"].append(
            {"role": "user", "content": user_input}
        )
        with st.chat_message("user"):
            st.markdown(user_input)

        with st.chat_message("assistant"):
            with st.spinner("Consultando material e IA…"):
                prov       = st.session_state.get("chat_provider", "gemini")
                model_name = st.session_state.get("chat_model", _GEMINI_MODELS[0])
                answer, sources = _get_answer(conn, prov, api_key, model_name, user_input)
            st.markdown(answer)
            if sources:
                with st.expander(
                    f"📚 Fontes consultadas ({len(sources)})",
                    expanded=False,
                ):
                    for src in sources:
                        st.markdown(
                            f"**{src['fonte']}**  \n"
                            f"<span style='font-size:0.78rem;color:#666'>"
                            f"{src['conteudo'][:220]}…</span>",
                            unsafe_allow_html=True,
                        )

        st.session_state["chat_history"].append(
            {"role": "assistant", "content": answer, "sources": sources}
        )
        st.rerun()
