"""
app.py — Orquestrador principal do TAO
Ponto de entrada: streamlit run app.py
"""

import streamlit as st
import streamlit.components.v1 as _components
from pathlib import Path

# ── Configuração da página (deve ser a PRIMEIRA chamada Streamlit) ────────────
st.set_page_config(
    page_title="TAO",
    page_icon="🗂️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Importações internas (após set_page_config) ───────────────────────────────
from database.db_connection import get_connection
from modules.sidebar import render_sidebar
from modules.document_viewer import render_document_viewer
from modules.annotation_panel import render_annotation_panel
from modules.chatbot import render_chatbot
from modules.pdf_export import render_export_buttons
from modules.question_form import render_question_manager
from modules.quiz_session import render_quiz

# ── CSS global (fonte Inter + estilos) ───────────────────────────────────────
def _load_css() -> None:
    css_path = Path(__file__).parent / "assets" / "style.css"
    if css_path.exists():
        st.markdown(
            f"<style>{css_path.read_text(encoding='utf-8')}</style>",
            unsafe_allow_html=True,
        )

_load_css()

# ── Menus de contexto: blocos (visualização) + formatação (edição) ────────────
# height=1 garante execução do script no iframe.
_components.html(
    """
    <script>
    (function() {
        var pdoc = window.parent.document;

        // ── Limpa instâncias anteriores ───────────────────────
        ['tao-ctx-menu','tao-fmt-menu','tao-ctx-style'].forEach(function(id) {
            var el = pdoc.getElementById(id);
            if (el) el.remove();
        });

        // ── CSS compartilhado ─────────────────────────────────
        var style = pdoc.createElement('style');
        style.id  = 'tao-ctx-style';
        style.textContent = [
            '.tao-menu{position:fixed;z-index:99999;background:#fff;',
            'border:1px solid #ddd;border-radius:7px;',
            'box-shadow:0 4px 18px rgba(0,0,0,0.13);',
            'padding:4px 0;min-width:185px;display:none;',
            'font-family:Inter,sans-serif;font-size:0.85rem;pointer-events:auto}',
            '.tao-menu .sep{border:none;border-top:1px solid #eee;margin:3px 0}',
            '.tao-menu [data-action],.tao-menu [data-fmt]{',
            'padding:7px 16px;cursor:pointer;color:#222;',
            'white-space:nowrap;user-select:none;display:flex;',
            'align-items:center;gap:7px}',
            '.tao-menu [data-action]:hover,.tao-menu [data-fmt]:hover{',
            'background:#f0f1ff;color:#3730a3}',
        ].join('');
        pdoc.head.appendChild(style);

        // ── Menu 1: ações de bloco (modo visualização) ────────
        var blockMenu = pdoc.createElement('div');
        blockMenu.id        = 'tao-ctx-menu';
        blockMenu.className = 'tao-menu';
        blockMenu.innerHTML =
            '<div data-action="anotacao">📝 Abrir anotações</div>' +
            '<div data-action="editar">✏️ Editar bloco</div>';
        pdoc.body.appendChild(blockMenu);

        // ── Menu 2: formatação de texto (modo edição / textarea) ─
        var fmtMenu = pdoc.createElement('div');
        fmtMenu.id        = 'tao-fmt-menu';
        fmtMenu.className = 'tao-menu';
        fmtMenu.innerHTML =
            '<div data-fmt="bold">'   +
            '  <span style="font-weight:700;font-size:1rem">B</span> Negrito' +
            '</div>' +
            '<div data-fmt="italic">' +
            '  <span style="font-style:italic;font-size:1rem">I</span> Itálico' +
            '</div>' +
            '<div data-fmt="bold_italic">' +
            '  <span style="font-weight:700;font-style:italic;font-size:1rem">BI</span> Negrito + Itálico' +
            '</div>' +
            '<hr class="sep">' +
            '<div data-fmt="bordo">'  +
            '  <span style="color:#550000;font-size:1rem">A</span> Cor bordô' +
            '</div>' +
            '<div data-fmt="preto">'  +
            '  <span style="color:#111;font-size:1rem">A</span> Cor preta (padrão)' +
            '</div>';
        pdoc.body.appendChild(fmtMenu);

        // ── Estado ────────────────────────────────────────────
        var currentBid      = null;
        var activeTextarea  = null;
        var selStart = 0, selEnd = 0;

        function hideAll() {
            blockMenu.style.display = 'none';
            fmtMenu.style.display   = 'none';
            currentBid     = null;
            activeTextarea = null;
        }

        function menuPos(cx, cy, minW) {
            var pw = window.parent.innerWidth  || pdoc.documentElement.clientWidth;
            var ph = window.parent.innerHeight || pdoc.documentElement.clientHeight;
            return {
                x: Math.min(cx, pw - (minW + 10)),
                y: Math.min(cy, ph - 170),
            };
        }

        // ── Fecha ao clicar fora / Esc ────────────────────────
        pdoc.addEventListener('click', function(e) {
            if (!blockMenu.contains(e.target) && !fmtMenu.contains(e.target))
                hideAll();
        });
        pdoc.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') hideAll();
        });

        // ── Listener único de contextmenu ─────────────────────
        pdoc.addEventListener('contextmenu', function(e) {
            hideAll();

            // CASO A: clique dentro de <textarea> com texto selecionado
            if (e.target.tagName === 'TEXTAREA') {
                var ta = e.target;
                var ss = ta.selectionStart, se = ta.selectionEnd;
                if (ss === se) return;          // sem seleção → menu nativo
                e.preventDefault();
                activeTextarea = ta;
                selStart = ss;
                selEnd   = se;
                var p = menuPos(e.clientX, e.clientY, 210);
                fmtMenu.style.left    = p.x + 'px';
                fmtMenu.style.top     = p.y + 'px';
                fmtMenu.style.display = 'block';
                return;
            }

            // CASO B: clique sobre .bloco-wrapper (data-bid)
            var el = e.target;
            while (el && el !== pdoc.body) {
                if (el.dataset && el.dataset.bid) break;
                el = el.parentElement;
            }
            if (!el || !el.dataset || !el.dataset.bid) return;
            e.preventDefault();
            currentBid = el.dataset.bid;
            var p = menuPos(e.clientX, e.clientY, 200);
            blockMenu.style.left    = p.x + 'px';
            blockMenu.style.top     = p.y + 'px';
            blockMenu.style.display = 'block';
        });

        // ── Ações: menu de bloco ──────────────────────────────
        blockMenu.addEventListener('click', function(e) {
            e.stopPropagation();
            var item = e.target.closest('[data-action]');
            if (!item || !currentBid) { hideAll(); return; }
            var action = item.dataset.action;
            var bid    = currentBid;
            hideAll();
            var prefix = action === 'anotacao' ? 'st-key-sel_' : 'st-key-edit_';
            var containers = pdoc.querySelectorAll('[class*="' + prefix + bid + '"]');
            for (var i = 0; i < containers.length; i++) {
                var btn = containers[i].querySelector('button');
                if (btn) { btn.click(); break; }
            }
        });

        // ── Ações: menu de formatação ─────────────────────────
        fmtMenu.addEventListener('click', function(e) {
            e.stopPropagation();
            var item = e.target.closest('[data-fmt]');
            if (!item || !activeTextarea) { hideAll(); return; }

            var fmt = item.dataset.fmt;
            var ta  = activeTextarea;
            var val = ta.value;
            var sel = val.substring(selStart, selEnd);

            var prefix, suffix;
            switch (fmt) {
                case 'bold':
                    prefix = '**'; suffix = '**'; break;
                case 'italic':
                    prefix = '*';  suffix = '*';  break;
                case 'bold_italic':
                    prefix = '***'; suffix = '***'; break;
                case 'bordo':
                    prefix = '<span style="color:#550000">'; suffix = '</span>'; break;
                case 'preto':
                    prefix = '<span style="color:#111111">'; suffix = '</span>'; break;
            }

            var newVal = val.substring(0, selStart)
                       + prefix + sel + suffix
                       + val.substring(selEnd);

            // Atualiza o <textarea> e dispara o evento de mudança do React
            var setter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
            ).set;
            setter.call(ta, newVal);
            ta.dispatchEvent(new Event('input',  { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));

            // Reposiciona o cursor após o texto formatado
            var newCursor = selStart + prefix.length + sel.length + suffix.length;
            ta.setSelectionRange(newCursor, newCursor);
            ta.focus();

            hideAll();
        });
    })();
    </script>
    """,
    height=1,
)

# ── Ctrl+Z global: captura no documento e aciona botão ↩ Desfazer ────────────
_components.html(
    """
    <script>
    (function() {
        if (window.parent.__taoUndoListenerAdded) return;
        window.parent.__taoUndoListenerAdded = true;
        window.parent.document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                // Não interfere quando o foco está em campos de texto editáveis
                var tag = document.activeElement ? document.activeElement.tagName : '';
                if (tag === 'TEXTAREA' || tag === 'INPUT') return;
                e.preventDefault();
                e.stopPropagation();
                // Localiza o botão ↩ Desfazer pelo texto e clica
                var btns = window.parent.document.querySelectorAll('button');
                for (var i = 0; i < btns.length; i++) {
                    if (btns[i].textContent.trim().startsWith('\u21a9')) {
                        btns[i].click();
                        break;
                    }
                }
            }
        }, true);
    })();
    </script>
    """,
    height=0,
)

# ── Conexão com o banco de dados (modo ativo: sqlite ou supabase) ─────────────
conn = get_connection()  # roteador em db_connection.py respeita st.session_state["db_mode"]

# ── Sidebar hierárquica ───────────────────────────────────────────────────────
render_sidebar(conn)

# ── Área principal ────────────────────────────────────────────────────────────
app_mode = st.session_state.get("app_mode", "documentos")

# ── Modo: Banco de Questões ───────────────────────────────────────────────────
if app_mode == "questoes":
    render_question_manager(conn)
    st.stop()

# ── Modo: Sessão de Estudo (Quiz) ─────────────────────────────────────────────
if app_mode == "quiz":
    render_quiz(conn)
    st.stop()

# ── Modo: Documentos (padrão) ─────────────────────────────────────────────────
active_doc_id     = st.session_state.get("active_document_id")
active_doc_titulo = st.session_state.get("active_document_titulo", "")

if active_doc_id is None:
    _, col_center, _ = st.columns([1.625, 0.75, 1.625])
    with col_center:
        st.markdown("<div style='height:6vh'></div>", unsafe_allow_html=True)
        mountain_path = Path(__file__).parent / "mountain.png"
        if mountain_path.exists():
            st.image(str(mountain_path), use_container_width=True)
        st.markdown(
            """
            <div style='
                text-align:center; color:#bbb;
                font-family:Inter,sans-serif;
                font-size:1.05rem; font-weight:500;
                margin-top:0.6rem;
            '>
                The mountain is only there so you have a place to walk.
            </div>
            """,
            unsafe_allow_html=True,
        )
else:
    # ── Barra de ferramentas acima das colunas ────────────────
    tb_left, tb_mid, tb_right = st.columns([3, 1, 1])

    with tb_mid:
        show_chat = st.session_state.get("show_chatbot", False)
        if st.button(
            "🤖 Assistente" if not show_chat else "📝 Anotações",
            key="toggle_chatbot",
            use_container_width=True,
            help="Alternar entre Anotações de Link e Assistente de Revisão RAG",
        ):
            st.session_state["show_chatbot"] = not show_chat
            st.rerun()

    # (exportação movida para o cabeçalho da coluna esquerda)

    # ── Colunas principais ────────────────────────────────────
    col_left, col_right = st.columns([1, 1], gap="large")

    # ── Coluna esquerda: Documento Mestre ─────────────────────
    with col_left:
        # Cabeçalho da coluna: título + botão de exportação
        hdr_title, hdr_export = st.columns([5, 1])
        with hdr_title:
            st.markdown(
                f"<p style='font-family:Inter,sans-serif;font-size:0.78rem;"
                f"color:#888;margin:0 0 4px 0;'>📄 Documento</p>",
                unsafe_allow_html=True,
            )
        with hdr_export:
            with st.popover("⋯", use_container_width=True, help="Exportar documento"):
                st.caption("📤 Exportar documento")
                render_export_buttons(conn, active_doc_id, active_doc_titulo)

        render_document_viewer(conn, active_doc_id, active_doc_titulo)

    # ── Coluna direita: Anotações de Link ou Chatbot ──────────
    with col_right:
        if st.session_state.get("show_chatbot"):
            render_chatbot(conn)
        else:
            render_annotation_panel(
                conn,
                bloco_id=st.session_state.get("active_bloco_id"),
                doc_titulo=active_doc_titulo,
            )
