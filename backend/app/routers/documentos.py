"""
Router – /api/v1/documentos
============================

Endpoints
---------
GET  /documentos/pasta/{pasta_id}       → list docs in a folder (flat)
GET  /documentos/{doc_id}               → doc header + all blocos ordered by ordem
POST /documentos                        → create a document
PATCH /documentos/{doc_id}              → update title / description / pasta / ordem
DELETE /documentos/{doc_id}             → delete (cascades to blocos + anotacoes)
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status

from app.database import db
from app.models.documentos import Documento, DocumentoCreate, DocumentoUpdate
from app.models.blocos import Bloco

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Response model: Documento with its blocos embedded
# ─────────────────────────────────────────────────────────────────────────────

class DocumentoDetail(Documento):
    """Documento row with all associated blocos pre-loaded."""

    blocos: list[Bloco] = []

    model_config = Documento.model_config  # inherit from_attributes=True


# ─────────────────────────────────────────────────────────────────────────────
# GET /documentos/pasta/{pasta_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/pasta/{pasta_id}",
    response_model=list[Documento],
    summary="List documents in a folder",
)
async def list_documentos_by_pasta(pasta_id: str) -> list[Documento]:
    """Return all documents belonging to *pasta_id*, ordered by ``ordem``."""
    # Verify the folder exists first (gives a clear 404 vs an empty list)
    pasta_exists = await db.fetchval(
        "SELECT 1 FROM pastas WHERE id = $1", pasta_id
    )
    if not pasta_exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pasta {pasta_id} não encontrada",
        )

    rows = await db.fetch(
        """
        SELECT id, pasta_id, titulo, descricao, ordem, criado_em, atualizado_em
        FROM documentos
        WHERE pasta_id = $1
        ORDER BY ordem, id
        """,
        pasta_id,
    )
    return [Documento(**dict(r)) for r in rows]


# ─────────────────────────────────────────────────────────────────────────────
# GET /documentos/{doc_id}   — document + all blocos
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/{doc_id}",
    response_model=DocumentoDetail,
    summary="Fetch a document with all its blocos",
)
async def get_documento(doc_id: str) -> DocumentoDetail:
    """Return the document header AND every bloco ordered by ``ordem``.

    The ``blocos`` list is always present (may be empty for a new document).
    The server-generated ``fts_vector`` column is **excluded** from the bloco
    payload; every other column is returned.
    """
    doc_row = await db.fetchrow(
        """
        SELECT id, pasta_id, titulo, descricao, ordem, criado_em, atualizado_em
        FROM documentos
        WHERE id = $1
        """,
        doc_id,
    )
    if doc_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Documento {doc_id} não encontrado",
        )

    bloco_rows = await db.fetch(
        """
        SELECT
            id, documento_id, tipo, identificador, conteudo, ordem,
            importancia, cor_fonte, alinhamento,
            revisado, last_review, next_review,
            stability, difficulty, reps, lapses,
            chroma_synced, chroma_id,
            criado_em, atualizado_em
        FROM blocos
        WHERE documento_id = $1
        ORDER BY ordem, id
        """,
        doc_id,
    )

    return DocumentoDetail(
        **dict(doc_row),
        blocos=[Bloco(**dict(r)) for r in bloco_rows],
    )


# ─────────────────────────────────────────────────────────────────────────────
# POST /documentos
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=Documento,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new document",
)
async def create_documento(payload: DocumentoCreate) -> Documento:
    # Validate the target folder exists
    pasta_exists = await db.fetchval(
        "SELECT 1 FROM pastas WHERE id = $1", payload.pasta_id
    )
    if not pasta_exists:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"pasta_id {payload.pasta_id} não existe",
        )

    row = await db.fetchrow(
        """
        INSERT INTO documentos (pasta_id, titulo, descricao, ordem)
        VALUES ($1, $2, $3, $4)
        RETURNING id, pasta_id, titulo, descricao, ordem, criado_em, atualizado_em
        """,
        payload.pasta_id,
        payload.titulo,
        payload.descricao,
        payload.ordem,
    )
    return Documento(**dict(row))


# ─────────────────────────────────────────────────────────────────────────────
# PATCH /documentos/{doc_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.patch(
    "/{doc_id}",
    response_model=Documento,
    summary="Update document metadata",
)
async def update_documento(doc_id: str, payload: DocumentoUpdate) -> Documento:
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nenhum campo fornecido para atualização",
        )

    set_clauses = [f"{col} = ${i + 2}" for i, col in enumerate(updates.keys())]
    values = list(updates.values())

    # atualizado_em is maintained by DB trigger, but we can also force it here
    row = await db.fetchrow(
        f"""
        UPDATE documentos
        SET {", ".join(set_clauses)}
        WHERE id = $1
        RETURNING id, pasta_id, titulo, descricao, ordem, criado_em, atualizado_em
        """,
        doc_id,
        *values,
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Documento {doc_id} não encontrado",
        )
    return Documento(**dict(row))


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /documentos/{doc_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.delete(
    "/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a document (cascades to blocos and anotacoes)",
)
async def delete_documento(doc_id: str) -> None:
    status_str = await db.execute(
        "DELETE FROM documentos WHERE id = $1", doc_id
    )
    if status_str == "DELETE 0":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Documento {doc_id} não encontrado",
        )
