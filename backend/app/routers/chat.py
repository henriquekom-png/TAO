"""
Router – /api/v1/chat
=====================

POST /chat/ask
    Full RAG pipeline:
      1. Search ChromaDB (materiais + blocos) via vector_service.
      2. Optionally augment with PostgreSQL FTS on blocos.
      3. Call Gemini via ai_service.generate_response().
      4. Return answer + sources.

GET /chat/status
    Returns ChromaDB collection stats (chunk counts) — useful for
    the frontend's configuration panel.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.database import db
from app.services import ai_service

router  = APIRouter()
logger  = logging.getLogger(__name__)

# ── Request / Response models ─────────────────────────────────────────────────

class ChatMessage(BaseModel):
    """Single turn in the conversation history."""

    role:    str = Field(..., pattern="^(user|model|assistant)$")
    content: str


class ChatRequest(BaseModel):
    """POST /chat/ask body."""

    question: str = Field(..., min_length=1, max_length=4000)
    history:  list[ChatMessage] = Field(
        default_factory=list,
        description="Previous turns (user + model). Max 20 kept.",
        max_length=20,
    )
    model:    str = Field(
        default=ai_service.DEFAULT_MODEL,
        description="Gemini model ID to use for this request",
    )
    n_results: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Number of vector search hits to include in context",
    )


class SourceChunk(BaseModel):
    """A single context chunk shown to the user as a citation."""

    fonte:    str
    conteudo: str
    score:    float


class ChatResponse(BaseModel):
    answer:  str
    sources: list[SourceChunk]
    model:   str


class ChatStatus(BaseModel):
    materiais_chunks: int
    blocos_chunks:    int
    gemini_model:     str


# ── FTS augmentation (PostgreSQL plainto_tsquery) ─────────────────────────────

async def _fts_search(query: str, limit: int = 4) -> list[dict]:
    """
    Full-text search on blocos using DatabaseManager's hybrid FTS.
    Includes a fallback LIKE search on anotacoes.
    Returns same dict shape as vector_service.search() for uniform merging.
    """
    results = []
    seen_blocos = set()
    
    try:
        # 1. Primary Search using Hybrid DatabaseManager (Postgres TSVector / SQLite FTS5)
        bloco_rows = await db.search_blocos_fts(query, limit)
        for b in bloco_rows:
            seen_blocos.add(b['id'])
            
        # 2. Secondary Search (Fallback) on anotacoes using LIKE (ALWAYS run to prioritize annotations)
        keywords = [k for k in query.split() if len(k) > 3]
        if keywords:
            clauses = []
            for i in range(len(keywords)):
                clauses.append(f"a.conteudo ILIKE ${i+1}")
            like_clauses = " OR ".join(clauses)
            params = [f"%{k}%" for k in keywords]
            
            fallback_query = f"""
                SELECT b.id, b.conteudo, b.identificador, b.documento_id
                FROM anotacoes a
                JOIN blocos b ON a.bloco_id = b.id
                WHERE ({like_clauses})
                  AND b.deleted_at IS NULL
                LIMIT {limit}
            """
            fallback_rows = await db.fetch(fallback_query, *params)
            for fb in fallback_rows:
                if fb['id'] not in seen_blocos:
                    seen_blocos.add(fb['id'])
                    bloco_rows.append(fb)
                        
        # 3. Process the collected blocks
        for row in bloco_rows:
            doc_titulo = await db.fetchval("SELECT titulo FROM documentos WHERE id = $1", row['documento_id'])
            
            fonte = f"📖 {doc_titulo} — {row['identificador'] or ''}"
            results.append({
                "fonte":    fonte,
                "conteudo": row["conteudo"],
                "score":    0.75,
            })

            anot_rows = await db.fetch(
                """
                SELECT a.conteudo, a.tipo
                FROM anotacoes a
                WHERE a.bloco_id = $1
                  AND a.tipo IN ('texto', 'tabela', 'fluxograma')
                  AND TRIM(COALESCE(a.conteudo, '')) <> ''
                ORDER BY a.ordem
                LIMIT 3
                """,
                row["id"],
            )
            for ar in anot_rows:
                tipo_icon = "📊" if ar["tipo"] == "tabela" else ("🔀" if ar["tipo"] == "fluxograma" else "📝")
                results.append({
                    "fonte": f"{tipo_icon} § Notas — {doc_titulo} ({row['identificador'] or 'bloco'})",
                    "conteudo": (
                        f"[Referência do bloco — trecho]\n{(row['conteudo'] or '')[:360]}\n\n"
                        f"[Anotação do utilizador]\n{ar['conteudo']}"
                    ),
                    "score": 0.78,
                })

    except Exception as exc:
        logger.warning("FTS search / Fallback failed: %s", exc)

    return results


def _dedupe(sources: list[dict], max_items: int = 12) -> list[dict]:
    """Deduplicate sources by conteudo prefix and keep top-scoring ones."""
    seen: set[str] = set()
    out:  list[dict] = []
    for s in sorted(sources, key=lambda x: x["score"], reverse=True):
        key = s["conteudo"][:80]
        if key not in seen:
            seen.add(key)
            out.append(s)
        if len(out) >= max_items:
            break
    return out


# ── POST /chat/ask ────────────────────────────────────────────────────────────

@router.post(
    "/ask",
    response_model=ChatResponse,
    summary="RAG-powered Q&A using Gemini + ChromaDB",
    description=(
        "Orchestrates a full RAG pipeline:\n"
        "1. Semantic search in ChromaDB (materiais + blocos)\n"
        "2. PostgreSQL FTS on blocos (plainto_tsquery Portuguese)\n"
        "3. Deduplicated context passed to Gemini via google.genai v1+\n"
        "4. Returns the answer + annotated sources"
    ),
)
async def chat_ask(body: ChatRequest) -> ChatResponse:
    # ── 1. PostgreSQL FTS augmentation ────────────────────────────
    fts_hits = await _fts_search(body.question)

    all_sources = _dedupe(fts_hits)

    # ── 2. Call Gemini ─────────────────────────────────────────────
    history_dicts = [
        {"role": m.role, "content": m.content}
        for m in body.history
    ]

    try:
        answer = await ai_service.generate_response(
            question = body.question,
            sources  = all_sources,
            history  = history_dicts or None,
            model    = body.model,
        )
    except Exception as exc:
        logger.error("AI generation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Erro ao chamar a API Gemini: {exc}",
        )

    return ChatResponse(
        answer  = answer,
        sources = [SourceChunk(**s) for s in all_sources],
        model   = body.model,
    )


# ── GET /chat/status ──────────────────────────────────────────────────────────

@router.get(
    "/status",
    response_model=ChatStatus,
    summary="ChromaDB and Gemini status",
)
async def chat_status() -> ChatStatus:
    """Returns chunk counts for both collections and the default model."""
    # As we have removed ChromaDB, we return 0 for chunk counts.
    # The frontend status panel can be updated later if needed.
    mat_n, bloco_n = 0, 0
    return ChatStatus(
        materiais_chunks = mat_n,
        blocos_chunks    = bloco_n,
        gemini_model     = ai_service.DEFAULT_MODEL,
    )


import asyncio  # noqa: E402 — needed by chat_status, imported at bottom to keep header clean
