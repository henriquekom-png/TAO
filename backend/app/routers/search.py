"""
Router – /api/v1/search
=======================

Endpoint para busca global (Documentos, Blocos e Anotações).
"""

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from typing import List, Literal, Optional

from app.database import db
from app.routers.nodes import _build_pasta_path

router = APIRouter()

class SearchResultItem(BaseModel):
    kind: Literal["documento", "bloco", "anotacao"]
    id: str
    title: str
    subtitle: Optional[str] = None
    documento_id: int
    bloco_id: Optional[str] = None
    pasta_id: int
    pasta_path: List[str] = Field(default_factory=list)

class SearchResponse(BaseModel):
    results: List[SearchResultItem]

@router.get("/", response_model=SearchResponse, summary="Busca Global em Documentos, Blocos e Anotações")
async def global_search(q: str = Query(..., min_length=1, description="Termo de busca")):
    """
    Retorna até 15 resultados contendo o termo `q`, divididos entre Documentos, Blocos e Anotações.
    Busca usando ILIKE (PostgreSQL).
    """
    operator = "ILIKE"
    
    term_db = f"%{q}%"
    limit_per_type = 10

    results_items: List[SearchResultItem] = []

    # 1. Documentos
    query_docs = f"""
        SELECT id, pasta_id, titulo, descricao
        FROM documentos
        WHERE titulo {operator} $1
        LIMIT $2
    """
    rows_docs = await db.fetch(query_docs, term_db, limit_per_type)
    for r in rows_docs:
        pasta_path = await _build_pasta_path(str(r["pasta_id"]))
        results_items.append(
            SearchResultItem(
                kind="documento",
                id=str(r["id"]),
                title=r["titulo"] or "",
                subtitle=r["descricao"][:60] + "..." if r["descricao"] and len(r["descricao"]) > 60 else (r["descricao"] or ""),
                documento_id=str(r["id"]),
                bloco_id=None,
                pasta_id=str(r["pasta_id"]),
                pasta_path=pasta_path
            )
        )

    # 2. Blocos
    query_blocos = f"""
        SELECT b.id, b.documento_id, b.conteudo, b.identificador, d.pasta_id, d.titulo as documento_titulo
        FROM blocos b
        JOIN documentos d ON d.id = b.documento_id
        WHERE b.conteudo {operator} $1 OR b.identificador {operator} $1
        LIMIT $2
    """
    rows_blocos = await db.fetch(query_blocos, term_db, limit_per_type)
    for r in rows_blocos:
        pasta_path = await _build_pasta_path(str(r["pasta_id"]))
        title_bloco = f"Em: {r['documento_titulo']}"
        if r["identificador"]:
            title_bloco += f" ({r['identificador']})"
            
        results_items.append(
            SearchResultItem(
                kind="bloco",
                id=str(r["id"]),
                title=title_bloco,
                subtitle=r["conteudo"][:100] + "..." if r["conteudo"] and len(r["conteudo"]) > 100 else (r["conteudo"] or ""),
                documento_id=str(r["documento_id"]),
                bloco_id=str(r["id"]),
                pasta_id=str(r["pasta_id"]),
                pasta_path=pasta_path
            )
        )

    # 3. Anotações
    query_anots = f"""
        SELECT a.id, a.bloco_id, a.conteudo, b.documento_id, d.pasta_id, d.titulo as documento_titulo
        FROM anotacoes a
        JOIN blocos b ON b.id = a.bloco_id
        JOIN documentos d ON d.id = b.documento_id
        WHERE a.conteudo {operator} $1
        LIMIT $2
    """
    rows_anots = await db.fetch(query_anots, term_db, limit_per_type)
    for r in rows_anots:
        pasta_path = await _build_pasta_path(str(r["pasta_id"]))
        results_items.append(
            SearchResultItem(
                kind="anotacao",
                id=str(r["id"]),
                title=f"Anotação em: {r['documento_titulo']}",
                subtitle=r["conteudo"][:100] + "..." if r["conteudo"] and len(r["conteudo"]) > 100 else (r["conteudo"] or ""),
                documento_id=str(r["documento_id"]),
                bloco_id=str(r["bloco_id"]),
                pasta_id=str(r["pasta_id"]),
                pasta_path=pasta_path
            )
        )

    # Simple sorting heuristic: Exact or highly relevant matches first, we just return up to 30 items
    # and let the frontend display up to 10. Or we can just slice here.
    return SearchResponse(results=results_items)
