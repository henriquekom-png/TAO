"""
modules/sidebar.py
Renderiza a barra lateral hierárquica do TAO.
- Árvore de pastas expansível/recolhível (inspirada no RemNote)
- CRUD dinâmico de pastas e documentos via SQLite
- Seleção de documento atualiza st.session_state
"""

import time
from pathlib import Path
import streamlit as st
import streamlit.components.v1 as _st_comp
from database.db_connection import get_connection, fetchall, execute, DB_MODE_DEFAULT
from modules.material_upload import render_material_upload

_LOGO_PATH = Path(__file__).resolve().parent.parent / "tao.png"

# ── Ícones ────────────────────────────────────────────────────────────────────
ICON_DOCUMENTO   = "📄"
ICON_RAIZ        = "🗂️"
ICON_PASTA_FECHA = "📁"
ICON_PASTA_ABRE  = "📂"
ICON_ADD_PASTA   = "📂➕"
ICON_ADD_DOC     = "📄➕"

# Fator de indentação por nível (pastas)
INDENT_FACTOR = 0.4063
# Fator de indentação para documentos (30% do das pastas)
DOC_INDENT_FACTOR = INDENT_FACTOR


# ── Queries SQL ───────────────────────────────────────────────────────────────

def _get_subpastas(conn, parent_id):
    return fetchall(
        conn,
        "SELECT id, nome, nivel, ordem FROM pastas WHERE parent_id = ? ORDER BY ordem, nome",
        (parent_id,)
    )

def _get_documentos(conn, pasta_id):
    return fetchall(
        conn,
        "SELECT id, titulo FROM documentos WHERE pasta_id = ? ORDER BY titulo",
        (pasta_id,)
    )

def _criar_pasta(conn, parent_id: int, nome: str, nivel: int) -> None:
    max_ordem = fetchall(
        conn,
        "SELECT COALESCE(MAX(ordem), 0) as m FROM pastas WHERE parent_id = ?",
        (parent_id,)
    )[0]["m"]
    execute(
        conn,
        "INSERT INTO pastas (parent_id, nome, nivel, ordem) VALUES (?, ?, ?, ?)",
        (parent_id, nome.strip(), nivel, max_ordem + 1)
    )

def _deletar_pasta(conn, pasta_id: int) -> None:
    execute(conn, "DELETE FROM pastas WHERE id = ?", (pasta_id,))

def _renomear_pasta(conn, pasta_id: int, novo_nome: str) -> None:
    execute(conn, "UPDATE pastas SET nome = ? WHERE id = ?", (novo_nome.strip(), pasta_id))

def _criar_documento(conn, pasta_id: int, titulo: str) -> int:
    return execute(
        conn,
        "INSERT INTO documentos (pasta_id, titulo) VALUES (?, ?)",
        (pasta_id, titulo.strip())
    )

def _deletar_documento(conn, doc_id: int) -> None:
    execute(conn, "DELETE FROM documentos WHERE id = ?", (doc_id,))

def _renomear_documento(conn, doc_id: int, novo_titulo: str) -> None:
    execute(conn, "UPDATE documentos SET titulo = ? WHERE id = ?", (novo_titulo.strip(), doc_id))


# ── Renderização da árvore ────────────────────────────────────────────────────

def _render_documentos(conn, pasta_id: int, nivel: int) -> None:
    """
    Renderiza a lista de documentos de uma pasta (sem botões de adicionar).
    'nivel' é o mesmo da pasta mãe. Somamos 0.65 (peso da col_chv) para que o
    ícone 📄 fique alinhado ao início do nome da pasta mãe — sem coluna invisível.
    """
    docs = _get_documentos(conn, pasta_id)
    # spacer = espaço da pasta mãe + largura da coluna chevron (0.65)
    indent_w = nivel * DOC_INDENT_FACTOR + 0.65
    nome_w   = max(6.45 - indent_w * 0.3, 2.0)

    for doc in docs:
        doc_key  = f"doc_{doc['id']}"
        edit_key = f"edit_doc_{doc['id']}"

        # Ícones menores (0.45) deixam mais espaço para o título;
        # eles ficam ocultos por padrão e surgem no hover via CSS.
        _, col_doc, col_edit, col_del = st.columns([indent_w, nome_w, 0.45, 0.45])

        with col_doc:
            is_active = st.session_state.get("active_document_id") == doc["id"]
            label = (
                f"{ICON_DOCUMENTO} **{doc['titulo']}**"
                if is_active
                else f"{ICON_DOCUMENTO} {doc['titulo']}"
            )
            # help mostra o título completo quando truncado
            if st.button(label, key=doc_key, use_container_width=True, help=doc["titulo"]):
                st.session_state["active_document_id"]    = doc["id"]
                st.session_state["active_document_titulo"] = doc["titulo"]
                st.session_state["active_bloco_id"]       = None
                st.session_state["editing_id"]            = None
                st.rerun()

        with col_edit:
            if st.button("✏️", key=f"btn_edit_doc_{doc['id']}", help="Renomear"):
                st.session_state[edit_key] = True

        with col_del:
            if st.button("🗑️", key=f"btn_del_doc_{doc['id']}", help="Deletar documento"):
                st.session_state[f"confirm_del_doc_{doc['id']}"] = True

        if st.session_state.get(f"confirm_del_doc_{doc['id']}"):
            st.warning(f"Deletar **{doc['titulo']}**?")
            c1, c2 = st.columns(2)
            with c1:
                if st.button("Confirmar", key=f"confirm_yes_doc_{doc['id']}"):
                    _deletar_documento(conn, doc["id"])
                    if st.session_state.get("active_document_id") == doc["id"]:
                        st.session_state["active_document_id"] = None
                    st.session_state.pop(f"confirm_del_doc_{doc['id']}", None)
                    st.rerun()
            with c2:
                if st.button("Cancelar", key=f"confirm_no_doc_{doc['id']}"):
                    st.session_state.pop(f"confirm_del_doc_{doc['id']}", None)
                    st.rerun()

        if st.session_state.get(edit_key):
            novo = st.text_input(
                "Novo título:",
                value=doc["titulo"],
                key=f"input_rename_doc_{doc['id']}"
            )
            c1, c2 = st.columns(2)
            with c1:
                if st.button("Salvar", key=f"save_rename_doc_{doc['id']}"):
                    if novo.strip():
                        _renomear_documento(conn, doc["id"], novo)
                    st.session_state.pop(edit_key, None)
                    st.rerun()
            with c2:
                if st.button("Cancelar", key=f"cancel_rename_doc_{doc['id']}"):
                    st.session_state.pop(edit_key, None)
                    st.rerun()


def _render_action_buttons(conn, pasta_id: int, nivel: int, expand_key: str) -> None:
    """
    Dois ícones compactos lado a lado: 📂➕ (nova pasta) e 📄➕ (novo documento).
    Aparecem apenas quando nenhuma subpasta está expandida.
    """
    # Mesmo alinhamento dos documentos: spacer da pasta + largura da col_chv (0.65)
    indent_w     = nivel * INDENT_FACTOR + 0.65
    add_sub_key  = f"add_sub_{pasta_id}"
    add_doc_key  = f"add_doc_form_{pasta_id}"

    # Linha com dois ícones minúsculos + espaço
    _, ci1, ci2, _ = st.columns([indent_w, 0.55, 0.55, max(7.3 - indent_w, 2.0)])

    with ci1:
        if st.button(ICON_ADD_PASTA, key=f"btn_add_sub_{pasta_id}", help="Nova pasta"):
            st.session_state[add_sub_key] = True
            st.session_state.pop(add_doc_key, None)

    with ci2:
        if st.button(ICON_ADD_DOC, key=f"btn_add_doc_{pasta_id}", help="Novo documento"):
            st.session_state[add_doc_key] = True
            st.session_state.pop(add_sub_key, None)

    # Formulário: nova subpasta
    if st.session_state.get(add_sub_key):
        novo_nome = st.text_input("Nome da nova pasta:", key=f"input_sub_{pasta_id}")
        c1, c2 = st.columns(2)
        with c1:
            if st.button("Criar", key=f"criar_sub_{pasta_id}"):
                if novo_nome.strip():
                    _criar_pasta(conn, pasta_id, novo_nome, nivel + 1)
                    st.session_state[expand_key] = True
                    st.session_state.pop(add_sub_key, None)
                    st.rerun()
                else:
                    st.warning("Digite um nome.")
        with c2:
            if st.button("Cancelar", key=f"cancel_sub_{pasta_id}"):
                st.session_state.pop(add_sub_key, None)
                st.rerun()

    # Formulário: novo documento
    if st.session_state.get(add_doc_key):
        novo_titulo = st.text_input("Título do documento:", key=f"input_doc_{pasta_id}")
        c1, c2 = st.columns(2)
        with c1:
            if st.button("Criar", key=f"criar_doc_{pasta_id}"):
                if novo_titulo.strip():
                    _criar_documento(conn, pasta_id, novo_titulo)
                    st.session_state.pop(add_doc_key, None)
                    st.rerun()
                else:
                    st.warning("Digite um título.")
        with c2:
            if st.button("Cancelar", key=f"cancel_doc_{pasta_id}"):
                st.session_state.pop(add_doc_key, None)
                st.rerun()


def _render_pasta(conn, pasta, nivel: int) -> None:
    """
    Renderiza recursivamente uma pasta e seus filhos.
    - Ícone de pasta como botão de toggle (hover mostra chevron via CSS)
    - Indentação com coluna-espaçador proporcional ao nível
    """
    pasta_id   = pasta["id"]
    pasta_nome = pasta["nome"]
    subpastas  = _get_subpastas(conn, pasta_id)

    expand_key = f"expanded_{pasta_id}"
    if expand_key not in st.session_state:
        st.session_state[expand_key] = False

    is_expanded = st.session_state[expand_key]
    indent_w    = nivel * INDENT_FACTOR

    # Ícone do botão toggle: muda conforme estado e nível
    if nivel == 0:
        toggle_icon = ICON_RAIZ
    else:
        toggle_icon = ICON_PASTA_ABRE if is_expanded else ICON_PASTA_FECHA

    # Chave diferente conforme estado → CSS pode distinguir expanded/collapsed
    # para mostrar ▾ ou ▸ no hover
    chv_key = f"chv_e_{pasta_id}" if is_expanded else f"chv_c_{pasta_id}"

    with st.container():
        if indent_w > 0:
            _, col_chv, col_nome, col_edit, col_del = st.columns(
                [indent_w, 0.65, max(5.8 - indent_w * 0.3, 2.2), 0.6, 0.6]
            )
        else:
            col_chv, col_nome, col_edit, col_del = st.columns([0.65, 5.8, 0.6, 0.6])

        with col_chv:
            if st.button(toggle_icon, key=chv_key, help="Expandir/recolher"):
                st.session_state[expand_key] = not is_expanded
                st.rerun()

        with col_nome:
            if nivel == 0:
                st.markdown(
                    f"<span class='folder-root'>{pasta_nome}</span>",
                    unsafe_allow_html=True,
                )
            elif nivel == 1:
                st.markdown(
                    f"<span class='folder-l1'>{pasta_nome}</span>",
                    unsafe_allow_html=True,
                )
            else:
                st.markdown(
                    f"<span class='folder-l2'>{pasta_nome}</span>",
                    unsafe_allow_html=True,
                )

        with col_edit:
            if nivel > 0:
                if st.button("✏️", key=f"btn_ren_{pasta_id}", help="Renomear"):
                    st.session_state[f"ren_{pasta_id}"] = True

        with col_del:
            if nivel > 0:
                if st.button("🗑️", key=f"btn_del_{pasta_id}", help="Deletar pasta"):
                    st.session_state[f"confirm_del_{pasta_id}"] = True

    # ── Formulário: renomear pasta ────────────────────────────
    if st.session_state.get(f"ren_{pasta_id}"):
        novo_nome = st.text_input("Novo nome:", value=pasta_nome, key=f"input_ren_{pasta_id}")
        c1, c2 = st.columns(2)
        with c1:
            if st.button("Salvar", key=f"save_ren_{pasta_id}"):
                if novo_nome.strip():
                    _renomear_pasta(conn, pasta_id, novo_nome)
                st.session_state.pop(f"ren_{pasta_id}", None)
                st.rerun()
        with c2:
            if st.button("Cancelar", key=f"cancel_ren_{pasta_id}"):
                st.session_state.pop(f"ren_{pasta_id}", None)
                st.rerun()

    # ── Confirmar deleção de pasta ────────────────────────────
    if st.session_state.get(f"confirm_del_{pasta_id}"):
        st.warning(f"⚠️ Deletar **{pasta_nome}** e todo seu conteúdo?")
        c1, c2 = st.columns(2)
        with c1:
            if st.button("Confirmar", key=f"del_yes_{pasta_id}"):
                _deletar_pasta(conn, pasta_id)
                st.session_state.pop(f"confirm_del_{pasta_id}", None)
                st.rerun()
        with c2:
            if st.button("Cancelar", key=f"del_no_{pasta_id}"):
                st.session_state.pop(f"confirm_del_{pasta_id}", None)
                st.rerun()

    # ── Conteúdo expandido ────────────────────────────────────
    if is_expanded:
        for sub in subpastas:
            _render_pasta(conn, sub, nivel + 1)

        has_expanded_child = any(
            st.session_state.get(f"expanded_{sub['id']}", False)
            for sub in subpastas
        )

        _render_documentos(conn, pasta_id, nivel)

        # Dois ícones de ação só aparecem na pasta mais interna expandida
        if not has_expanded_child:
            _render_action_buttons(conn, pasta_id, nivel, expand_key)


# ── Chave Seletora de Banco ───────────────────────────────────────────────────

def _render_db_selector() -> None:
    """
    Toggle 🌐 Nuvem / 🏠 Local na sidebar.
    Controla st.session_state["db_mode"] que o roteador usa em get_connection().
    """
    # Inicializa o modo salvo (persiste via query param simulado em session_state)
    if "db_mode" not in st.session_state:
        st.session_state["db_mode"] = DB_MODE_DEFAULT

    current = st.session_state["db_mode"]

    st.markdown("##### 🗄️ Banco de dados")

    col_local, col_cloud = st.columns(2)
    with col_local:
        if st.button(
            "🏠 Local",
            use_container_width=True,
            type="primary" if current == "sqlite" else "secondary",
            key="db_btn_local",
            help="SQLite local — funciona sem internet",
        ):
            if current != "sqlite":
                st.session_state["db_mode"] = "sqlite"
                st.cache_resource.clear()   # força reconexão
                st.rerun()

    with col_cloud:
        if st.button(
            "🌐 Nuvem",
            use_container_width=True,
            type="primary" if current == "supabase" else "secondary",
            key="db_btn_cloud",
            help="Supabase — dados na nuvem, acesso web",
        ):
            if current != "supabase":
                st.session_state["db_mode"] = "supabase"
                st.cache_resource.clear()   # força reconexão
                st.rerun()

    # ── Aviso modo local ──────────────────────────────────────
    if current == "sqlite":
        st.info(
            "🏠 **Modo Local ativo.**  \n"
            "Alterações feitas aqui não sobem para a nuvem automaticamente.",
            icon=None,
        )
        if st.button("📤 Sincronizar Local → Nuvem", use_container_width=True,
                     key="btn_sync_up"):
            with st.spinner("Enviando dados para o Supabase…"):
                try:
                    from database.backup import sync_local_to_cloud
                    counts = sync_local_to_cloud()
                    total  = sum(counts.values())
                    st.success(
                        f"✅ Sincronização concluída — {total} registros enviados.\n\n"
                        + "\n".join(f"  • {t}: {n}" for t, n in counts.items())
                    )
                except Exception as exc:
                    st.error(f"❌ Erro: {exc}")

    # ── Botão de backup (modo nuvem) ──────────────────────────
    else:
        st.success("🌐 **Modo Nuvem ativo.**", icon=None)
        if st.button("📥 Baixar Cópia de Segurança para o PC",
                     use_container_width=True, key="btn_backup_down"):
            with st.spinner("Baixando dados do Supabase…"):
                try:
                    from database.backup import download_cloud_to_local
                    counts = download_cloud_to_local()
                    total  = sum(counts.values())
                    st.success(
                        f"✅ Backup local atualizado — {total} registros baixados.\n\n"
                        + "\n".join(f"  • {t}: {n}" for t, n in counts.items())
                    )
                except Exception as exc:
                    st.error(f"❌ Erro: {exc}")


# ── Cronômetro ────────────────────────────────────────────────────────────────

def _render_timer() -> None:
    """
    Cronômetro de sessão (hh:mm:ss) com Play/Pause e Stop.
    - O estado vive em st.session_state (persiste entre reruns).
    - O display atualiza a cada 500 ms via JavaScript, sem rerun do Streamlit.
    """
    running = st.session_state.get("timer_running", False)
    elapsed = st.session_state.get("timer_elapsed", 0.0)
    start   = st.session_state.get("timer_start",   None)

    # Tempo atual acumulado (lado Python — base para o JS)
    current = elapsed + (time.time() - start) if (running and start) else elapsed
    current = max(0.0, current)

    h = int(current // 3600)
    m = int((current % 3600) // 60)
    s = int(current % 60)

    # Componente JS: exibe e atualiza o display de forma autônoma
    _st_comp.html(
        f"""
        <style>
          body {{ margin:0; padding:0; overflow:hidden; background:transparent; }}
          #tao-timer {{
            font-family: 'Inter', 'Courier New', monospace;
            font-size: 1.55rem;
            font-weight: 700;
            letter-spacing: 0.12em;
            color: #1a1a1a;
            text-align: center;
            padding: 6px 0 2px 0;
            user-select: none;
          }}
          #tao-timer.running {{ color: #2563eb; }}
        </style>
        <div id="tao-timer" class="{'running' if running else ''}">{h:02d}:{m:02d}:{s:02d}</div>
        <script>
        (function() {{
            var running = {'true' if running else 'false'};
            var baseMs  = {current * 1000:.0f};
            var initAt  = Date.now();

            function pad(n) {{ return ('0' + n).slice(-2); }}
            function render(ms) {{
                var total = Math.floor(ms / 1000);
                var hh = Math.floor(total / 3600);
                var mm = Math.floor((total % 3600) / 60);
                var ss = total % 60;
                var el = document.getElementById('tao-timer');
                if (el) el.textContent = pad(hh) + ':' + pad(mm) + ':' + pad(ss);
            }}
            render(baseMs);
            if (running) {{
                setInterval(function() {{
                    render(baseMs + (Date.now() - initAt));
                }}, 500);
            }}
        }})();
        </script>
        """,
        height=52,
    )

    # Botões Play/Pause e Stop
    c1, c2 = st.columns(2)
    with c1:
        if running:
            if st.button("⏸ Pausar", key="timer_pause", use_container_width=True):
                st.session_state["timer_elapsed"] = current
                st.session_state["timer_running"] = False
                st.session_state["timer_start"]   = None
                st.rerun()
        else:
            if st.button("▶ Iniciar", key="timer_play", use_container_width=True):
                st.session_state["timer_running"] = True
                st.session_state["timer_start"]   = time.time()
                st.rerun()
    with c2:
        if st.button("⏹ Parar", key="timer_stop", use_container_width=True,
                     disabled=(current == 0.0)):
            st.session_state["timer_elapsed"] = 0.0
            st.session_state["timer_running"] = False
            st.session_state["timer_start"]   = None
            st.rerun()


# ── Ponto de entrada público ─────────────────────────────────────────────────

def render_sidebar(conn) -> None:
    """Função principal chamada pelo app.py."""
    if "active_document_id" not in st.session_state:
        st.session_state["active_document_id"] = None
    if "active_document_titulo" not in st.session_state:
        st.session_state["active_document_titulo"] = None
    if "active_bloco_id" not in st.session_state:
        st.session_state["active_bloco_id"] = None
    if "editing_id" not in st.session_state:
        st.session_state["editing_id"] = None

    with st.sidebar:
        if _LOGO_PATH.exists():
            _, col_logo, _ = st.columns([1, 1, 1])
            with col_logo:
                st.image(str(_LOGO_PATH), use_container_width=True)
            st.markdown("<div style='margin-bottom:20%;'></div>", unsafe_allow_html=True)
        else:
            st.markdown(
                "<div class='sidebar-header'>TAO</div>",
                unsafe_allow_html=True,
            )

        # ── Cronômetro de sessão ──────────────────────────────
        _render_timer()
        st.divider()

        raiz = fetchall(
            conn,
            "SELECT id, nome, nivel, ordem FROM pastas WHERE parent_id IS NULL ORDER BY ordem",
            (),
        )

        if not raiz:
            st.error("Pasta raiz 'TAO' não encontrada. Execute o schema.sql.")
            return

        for pasta in raiz:
            _render_pasta(conn, pasta, nivel=0)

        st.divider()
        with st.expander("⬆️ Material de Apoio", expanded=False):
            render_material_upload(conn)

        st.divider()
        with st.expander("🧪 Questões & Testes", expanded=False):
            if st.button("❓ Banco de Questões", use_container_width=True,
                         key="sb_questoes_btn"):
                st.session_state["app_mode"] = "questoes"
                st.session_state.pop("editing_questao_id", None)
                st.session_state.pop("show_nova_questao", None)
                st.rerun()
            if st.button("▶ Iniciar sessão de estudo", use_container_width=True,
                         key="sb_quiz_btn"):
                st.session_state["app_mode"] = "quiz"
                # Limpa sessão anterior
                for k in ["quiz_active", "quiz_questions", "quiz_idx",
                           "quiz_results", "quiz_answered", "quiz_answer_sel"]:
                    st.session_state.pop(k, None)
                st.rerun()

        st.divider()
        _render_db_selector()
