"""
modules/pdf_export.py
Sprint 9 — Exportação de documentos com PDF real.

Motores PDF (em ordem de preferência):
  1. xhtml2pdf  — puro Python, funciona em Windows/Linux/Mac sem dependências C.
  2. pdfkit     — requer wkhtmltopdf instalado no sistema (legado).
  3. Fallback   — download HTML (imprimir como PDF no browser com Ctrl+P).

Outras dependências:
  - jinja2  : sempre disponível (instalado pelo Streamlit).
"""

import io
import subprocess
from datetime import datetime
from pathlib import Path

import streamlit as st
from jinja2 import Environment, FileSystemLoader, select_autoescape
from database.db_connection import fetchall

BASE_DIR      = Path(__file__).resolve().parent.parent
TEMPLATE_DIR  = BASE_DIR / "templates"


# ── Verificação de motores PDF ────────────────────────────────────────────────

def _xhtml2pdf_ok() -> bool:
    try:
        from xhtml2pdf import pisa  # noqa
        return True
    except ImportError:
        return False


def _pdfkit_ok() -> tuple[bool, str]:
    """Retorna (disponível, mensagem). Verifica pdfkit e wkhtmltopdf."""
    try:
        import pdfkit  # noqa
    except ImportError:
        return False, "pdfkit não instalado."
    try:
        subprocess.run(
            ["wkhtmltopdf", "--version"],
            capture_output=True,
            check=True,
        )
        return True, ""
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False, "wkhtmltopdf não encontrado no sistema."


# ── Busca de dados ────────────────────────────────────────────────────────────

def _get_blocos_com_anotacoes(conn, documento_id: int) -> list[dict]:
    """Retorna blocos do documento com suas anotações de link."""
    blocos = fetchall(
        conn,
        """
        SELECT id, identificador, conteudo, importancia, cor_fonte, alinhamento
        FROM blocos
        WHERE documento_id = ?
        ORDER BY ordem
        """,
        (documento_id,),
    )
    result = []
    for b in blocos:
        anots = fetchall(
            conn,
            """
            SELECT tipo, conteudo FROM anotacoes
            WHERE bloco_id = ? AND conteudo != ''
            ORDER BY ordem
            """,
            (b["id"],),
        )
        result.append({
            "identificador": b["identificador"] or "",
            "conteudo":      b["conteudo"],
            "importancia":   b["importancia"] or "normal",
            "cor_fonte":     b["cor_fonte"]   or "preto",
            "alinhamento":   b["alinhamento"] or "justificado",
            "anotacoes":     [{"tipo": a["tipo"], "conteudo": a["conteudo"]} for a in anots],
        })
    return result


# ── Geração de HTML ───────────────────────────────────────────────────────────

def _render_html(titulo: str, blocos: list[dict]) -> str:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    tpl = env.get_template("export_doc.html")
    return tpl.render(
        titulo=titulo,
        blocos=blocos,
        data_exportacao=datetime.now().strftime("%d/%m/%Y às %H:%M"),
    )


def _html_to_pdf_xhtml2pdf(html: str) -> bytes | None:
    """Converte HTML em PDF usando xhtml2pdf (motor puro Python)."""
    try:
        from xhtml2pdf import pisa
        buf = io.BytesIO()
        result = pisa.CreatePDF(html.encode("utf-8"), dest=buf, encoding="utf-8")
        if result.err:
            st.error(f"Erro ao gerar PDF (xhtml2pdf): {result.err}")
            return None
        return buf.getvalue()
    except Exception as exc:
        st.error(f"Erro ao gerar PDF (xhtml2pdf): {exc}")
        return None


def _html_to_pdf_pdfkit(html: str) -> bytes | None:
    """Converte HTML em PDF usando pdfkit (motor legado)."""
    try:
        import pdfkit
        return pdfkit.from_string(html, False)
    except Exception as exc:
        st.error(f"Erro ao gerar PDF (pdfkit): {exc}")
        return None


def _html_to_pdf(html: str) -> bytes | None:
    """Tenta xhtml2pdf primeiro; cai para pdfkit se necessário."""
    if _xhtml2pdf_ok():
        return _html_to_pdf_xhtml2pdf(html)
    pdf_ok, _ = _pdfkit_ok()
    if pdf_ok:
        return _html_to_pdf_pdfkit(html)
    return None


# ── Widget de exportação ──────────────────────────────────────────────────────

def render_export_buttons(conn, documento_id: int, doc_titulo: str) -> None:
    """
    Renderiza botões de exportação para o documento ativo.
    Chame dentro de um st.popover ou container.
    """
    blocos = _get_blocos_com_anotacoes(conn, documento_id)

    if not blocos:
        st.caption("Nenhum bloco para exportar.")
        return

    html_content = _render_html(doc_titulo, blocos)
    nome_base    = doc_titulo.replace(" ", "_").replace("/", "-")[:40]

    # ── Download HTML ────────────────────────────────────────────
    st.download_button(
        label="⬇️ Baixar HTML (imprimir como PDF no browser)",
        data=html_content.encode("utf-8"),
        file_name=f"{nome_base}.html",
        mime="text/html",
        use_container_width=True,
        key=f"dl_html_{documento_id}",
    )

    # ── Download PDF ─────────────────────────────────────────────
    pdf_motor = "xhtml2pdf" if _xhtml2pdf_ok() else ("pdfkit" if _pdfkit_ok()[0] else None)
    if pdf_motor:
        if st.button(
            f"⬇️ Baixar PDF ({pdf_motor})",
            use_container_width=True,
            key=f"btn_gerar_pdf_{documento_id}",
        ):
            with st.spinner("Gerando PDF…"):
                pdf_bytes = _html_to_pdf(html_content)
            if pdf_bytes:
                st.download_button(
                    label="📄 Clique para baixar o PDF",
                    data=pdf_bytes,
                    file_name=f"{nome_base}.pdf",
                    mime="application/pdf",
                    use_container_width=True,
                    key=f"dl_pdf_{documento_id}",
                )
    else:
        st.caption("ℹ️ PDF direto indisponível.  \nUse o HTML + Ctrl+P no browser.")
