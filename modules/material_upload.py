"""
modules/material_upload.py
Sprint 6 — Upload de Material de Apoio.

Fluxo:
  1. Usuário faz upload de PDF / DOCX / TXT via st.file_uploader.
  2. O texto é extraído (PyMuPDF / python-docx / decode UTF-8).
  3. O arquivo é salvo em material_de_apoio/.
  4. Metadados são registrados na tabela `materiais` do SQLite.
  5. O texto é dividido em chunks e embeddings são gerados com
     SentenceTransformers (all-MiniLM-L6-v2).
  6. Os embeddings são indexados no ChromaDB com metadados de rastreamento.
  7. Listagem de materiais existentes com indicador ChromaDB e botão Deletar.

Ícone de sincronização:
  🟢 — indexado no ChromaDB
  🔴 — salvo localmente, ChromaDB pendente
"""

import io
import hashlib
import streamlit as st
from pathlib import Path
from database.db_connection import fetchall, execute

BASE_DIR  = Path(__file__).resolve().parent.parent
APOIO_DIR = BASE_DIR / "material_de_apoio"
APOIO_DIR.mkdir(exist_ok=True)


# ── Verificação de dependências opcionais ─────────────────────────────────────

def _check_deps() -> dict:
    """Retorna dicionário com disponibilidade de cada dependência opcional."""
    status: dict[str, bool] = {}

    try:
        import fitz  # PyMuPDF  # noqa: F401
        status["pymupdf"] = True
    except ImportError:
        status["pymupdf"] = False

    try:
        from docx import Document  # noqa: F401
        status["docx"] = True
    except ImportError:
        status["docx"] = False

    try:
        import chromadb  # noqa: F401
        status["chromadb"] = True
    except ImportError:
        status["chromadb"] = False

    try:
        from sentence_transformers import SentenceTransformer  # noqa: F401
        status["sentence_transformers"] = True
    except ImportError:
        status["sentence_transformers"] = False

    return status


# ── Extração de texto ─────────────────────────────────────────────────────────

def _extract_pdf(file_bytes: bytes) -> str:
    """Extrai texto de PDF usando PyMuPDF (fitz)."""
    import fitz
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pages = [page.get_text() for page in doc]
    doc.close()
    return "\n\n".join(pages)


def _extract_docx(file_bytes: bytes) -> str:
    """Extrai texto de DOCX usando python-docx."""
    from docx import Document
    doc = Document(io.BytesIO(file_bytes))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _extract_txt(file_bytes: bytes) -> str:
    """Decodifica TXT com fallback latin-1."""
    try:
        return file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        return file_bytes.decode("latin-1")


def _extrair_texto(nome_arquivo: str, file_bytes: bytes) -> str:
    ext = nome_arquivo.rsplit(".", 1)[-1].lower()
    if ext == "pdf":
        return _extract_pdf(file_bytes)
    if ext == "docx":
        return _extract_docx(file_bytes)
    return _extract_txt(file_bytes)


# ── Chunking ──────────────────────────────────────────────────────────────────

def _split_chunks(texto: str, max_chars: int = 800) -> list[str]:
    """
    Divide o texto em chunks por parágrafos duplos.
    Chunks muito longos são mantidos como unidades únicas.
    """
    paragrafos = [p.strip() for p in texto.split("\n\n") if p.strip()]
    chunks: list[str] = []
    buffer = ""
    for p in paragrafos:
        if len(buffer) + len(p) + 1 < max_chars:
            buffer = (buffer + " " + p).strip()
        else:
            if buffer:
                chunks.append(buffer)
            buffer = p
    if buffer:
        chunks.append(buffer)
    return chunks or [texto[:max_chars]]


# ── Encoder SentenceTransformers ──────────────────────────────────────────────

@st.cache_resource(show_spinner="Carregando modelo de embeddings…")
def _get_encoder():
    """Carrega all-MiniLM-L6-v2 uma única vez por sessão."""
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer("all-MiniLM-L6-v2")


# ── ChromaDB helpers ──────────────────────────────────────────────────────────

def _get_collection():
    from vector_store.chroma_client import get_collection
    return get_collection("tao_materiais")


def _embed_e_indexar(material_id: int, nome: str, tipo: str, texto: str) -> int:
    """
    Gera embeddings dos chunks e indexa no ChromaDB.
    Remove entradas antigas do mesmo material antes de re-indexar.
    Retorna o número de chunks indexados (0 em caso de erro).
    """
    try:
        encoder    = _get_encoder()
        collection = _get_collection()
        if collection is None:
            return 0

        chunks = _split_chunks(texto)
        ids        = [f"mat_{material_id}_chunk_{i}" for i in range(len(chunks))]
        embeddings = encoder.encode(chunks, show_progress_bar=False).tolist()
        metadatas  = [
            {"material_id": material_id, "nome": nome, "tipo": tipo, "chunk_idx": i}
            for i in range(len(chunks))
        ]

        # Remove versão anterior do mesmo material, se existir
        try:
            existing = collection.get(where={"material_id": material_id})
            if existing["ids"]:
                collection.delete(ids=existing["ids"])
        except Exception:
            pass

        collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=chunks,
            metadatas=metadatas,
        )
        return len(chunks)
    except Exception as exc:
        st.warning(f"ChromaDB: {exc}")
        return 0


def _deletar_do_chroma(material_id: int) -> None:
    """Remove todos os chunks de um material do ChromaDB."""
    try:
        collection = _get_collection()
        if collection is None:
            return
        existing = collection.get(where={"material_id": material_id})
        if existing["ids"]:
            collection.delete(ids=existing["ids"])
    except Exception:
        pass


# ── SQLite helpers ────────────────────────────────────────────────────────────

def _listar_materiais(conn) -> list:
    return fetchall(
        conn,
        "SELECT id, nome_arquivo, tipo, caminho, tamanho_bytes, chroma_synced, criado_em "
        "FROM materiais ORDER BY criado_em DESC",
    )


def _salvar_material(conn, nome: str, tipo: str, caminho: str, tamanho: int) -> int:
    return execute(
        conn,
        "INSERT INTO materiais (nome_arquivo, tipo, caminho, tamanho_bytes) VALUES (?,?,?,?)",
        (nome, tipo, caminho, tamanho),
    )


def _marcar_synced(conn, material_id: int) -> None:
    execute(conn, "UPDATE materiais SET chroma_synced=1 WHERE id=?", (material_id,))


def _deletar_material(conn, material_id: int) -> None:
    rows = fetchall(conn, "SELECT caminho FROM materiais WHERE id=?", (material_id,))
    if rows:
        try:
            Path(rows[0]["caminho"]).unlink(missing_ok=True)
        except Exception:
            pass
    _deletar_do_chroma(material_id)
    execute(conn, "DELETE FROM materiais WHERE id=?", (material_id,))


# ── Formatação auxiliar ───────────────────────────────────────────────────────

def _fmt_bytes(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 ** 2:
        return f"{n / 1024:.1f} KB"
    return f"{n / 1024 ** 2:.1f} MB"


# ── Renderização principal ────────────────────────────────────────────────────

def render_material_upload(conn) -> None:
    """Widget de upload e gestão de Material de Apoio integrado à sidebar."""
    deps = _check_deps()

    # ── Aviso de dependências ausentes ───────────────────────────
    faltando = []
    if not deps["pymupdf"]:
        faltando.append("`PyMuPDF` (PDF)")
    if not deps["docx"]:
        faltando.append("`python-docx` (DOCX)")
    if not deps["chromadb"]:
        faltando.append("`chromadb`")
    if not deps["sentence_transformers"]:
        faltando.append("`sentence-transformers`")
    if faltando:
        st.warning(
            "⚠️ Dependência(s) ausente(s): "
            + ", ".join(faltando)
            + ".  \nExecute: `pip install -r requirements.txt`"
        )

    # ── Widget de upload ─────────────────────────────────────────
    st.markdown("##### Enviar arquivo")
    tipos_aceitos: list[str] = []
    if deps["pymupdf"]:
        tipos_aceitos.append("pdf")
    if deps["docx"]:
        tipos_aceitos.append("docx")
    tipos_aceitos.append("txt")

    uploaded = st.file_uploader(
        "Arquivo",
        type=tipos_aceitos,
        key="material_uploader",
        label_visibility="collapsed",
    )

    if uploaded is not None:
        nome       = uploaded.name
        ext        = nome.rsplit(".", 1)[-1].lower()
        file_bytes = uploaded.read()
        tamanho    = len(file_bytes)

        # Usa hash do conteúdo para evitar colisões de nome
        nome_hash  = hashlib.md5(file_bytes).hexdigest()[:8]
        nome_salvo = f"{nome_hash}_{nome}"
        caminho    = str(APOIO_DIR / nome_salvo)

        pode_embed = deps["chromadb"] and deps["sentence_transformers"]
        label_btn  = f"⬆️ Processar '{nome}'"
        if st.button(label_btn, use_container_width=True, key="btn_processar_upload"):
            barra    = st.progress(0, text="Iniciando…")
            status   = st.empty()

            # 1. Extração de texto (25 %)
            barra.progress(10, text="🔍 Extraindo texto…")
            try:
                texto = _extrair_texto(nome, file_bytes)
            except Exception as exc:
                barra.empty()
                st.error(f"Erro ao extrair texto: {exc}")
                return
            barra.progress(25, text="✅ Texto extraído")

            # 2. Salvar arquivo em disco (40 %)
            barra.progress(30, text="💾 Salvando arquivo…")
            with open(caminho, "wb") as fh:
                fh.write(file_bytes)
            barra.progress(40, text="✅ Arquivo salvo")

            # 3. Registrar no SQLite (55 %)
            barra.progress(50, text="🗄️ Registrando no banco…")
            mid = _salvar_material(conn, nome, ext, caminho, tamanho)
            barra.progress(55, text="✅ Banco atualizado")

            # 4. Gerar embeddings e indexar no ChromaDB (55 → 95 %)
            n_chunks = 0
            if pode_embed:
                barra.progress(60, text="🧠 Carregando modelo de embeddings…")
                n_chunks = _embed_e_indexar(mid, nome, ext, texto)
                if n_chunks > 0:
                    _marcar_synced(conn, mid)
                barra.progress(95, text=f"✅ {n_chunks} chunks indexados")
            else:
                barra.progress(95, text="⚠️ ChromaDB indisponível — pulando embedding")

            barra.progress(100, text="✅ Concluído!")
            status.empty()

            if n_chunks > 0:
                st.success(f"✅ **{nome}** — {n_chunks} chunks indexados no ChromaDB.")
            else:
                st.success(
                    f"✅ **{nome}** salvo."
                    + (" (ChromaDB indisponível — sem embedding)" if not pode_embed else "")
                )
            st.rerun()

    # ── Lista de materiais existentes ─────────────────────────────
    st.divider()
    st.markdown("##### Materiais salvos")
    materiais = _listar_materiais(conn)

    if not materiais:
        st.caption("Nenhum material enviado ainda.")
        return

    for m in materiais:
        sync_icon = "🟢" if m["chroma_synced"] else "🔴"
        col_info, col_del = st.columns([5, 0.7])

        with col_info:
            st.markdown(
                f"{sync_icon} **{m['nome_arquivo']}**  \n"
                f"<span style='font-size:0.73rem;color:#888'>"
                f"{m['tipo'].upper()} · {_fmt_bytes(m['tamanho_bytes'] or 0)} · "
                f"{str(m['criado_em'])[:10]}"
                f"</span>",
                unsafe_allow_html=True,
            )

        with col_del:
            if st.button("🗑️", key=f"del_mat_{m['id']}", help="Deletar material"):
                st.session_state[f"confirm_del_mat_{m['id']}"] = True

        if st.session_state.get(f"confirm_del_mat_{m['id']}"):
            st.warning(f"Deletar **{m['nome_arquivo']}**?")
            c1, c2 = st.columns(2)
            with c1:
                if st.button("Confirmar", key=f"conf_del_mat_yes_{m['id']}"):
                    _deletar_material(conn, m["id"])
                    st.session_state.pop(f"confirm_del_mat_{m['id']}", None)
                    st.rerun()
            with c2:
                if st.button("Cancelar", key=f"conf_del_mat_no_{m['id']}"):
                    st.session_state.pop(f"confirm_del_mat_{m['id']}", None)
                    st.rerun()
