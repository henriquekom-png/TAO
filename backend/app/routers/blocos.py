"""
Router – /api/v1/blocos
========================

Endpoints
---------
POST /blocos                  → create a single bloco
POST /blocos/bulk             → create many blocos in one atomic transaction
POST /blocos/reorder          → bulk reorder (drag-and-drop)
POST /blocos/shift-ordem      → shift ordem of subsequent blocos up by 1 (before inline insert)
GET   /blocos/{bloco_id}      → fetch a single bloco
PATCH /blocos/{bloco_id}      → partial update (importancia, revisado, FSRS, etc.)
DELETE /blocos/{bloco_id}     → delete a bloco (cascades to anotacoes, portais)

Notes
-----
* All literal-path POST routes (/bulk, /reorder, /shift-ordem) are registered
  BEFORE the wildcard GET/PATCH/DELETE /{bloco_id} routes so that FastAPI
  never tries to cast "bulk", "reorder", or "shift-ordem" as an integer id.
* The ``fts_vector`` column is a server-generated tsvector and is **never**
  included in SELECT or UPDATE statements.
"""

from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.database import db
from app.models.blocos import Bloco, BlocoCreate, BlocoUpdate

router = APIRouter()

# ─────────────────────────────────────────────────────────────────────────────
# Shared column list (keep in sync with Bloco model)
# ─────────────────────────────────────────────────────────────────────────────

_BLOCO_COLS = """
    id, documento_id, tipo, identificador, conteudo, ordem,
    importancia, cor_fonte, alinhamento,
    revisado, last_review, next_review,
    stability, difficulty, reps, lapses,
    chroma_synced, chroma_id,
    criado_em, atualizado_em
"""


# ─────────────────────────────────────────────────────────────────────────────
# POST /blocos  — create a single bloco
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=Bloco,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new bloco",
)
async def create_bloco(payload: BlocoCreate) -> Bloco:
    """Insert a single bloco and return the created row."""
    row = await db.fetchrow(
        f"""
        INSERT INTO blocos (documento_id, tipo, identificador, conteudo, ordem,
                            importancia, cor_fonte, alinhamento, revisado)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING {_BLOCO_COLS}
        """,
        payload.documento_id,
        payload.tipo,
        payload.identificador,
        payload.conteudo,
        payload.ordem,
        payload.importancia,
        payload.cor_fonte,
        payload.alinhamento,
        payload.revisado,
    )
    return Bloco(**dict(row))


# ─────────────────────────────────────────────────────────────────────────────
# POST /blocos/bulk — create many blocos atomically
# ─────────────────────────────────────────────────────────────────────────────

class BulkBlocoItem(BaseModel):
    documento_id: int
    conteudo: str = ""
    ordem: int = Field(0, ge=0)
    tipo: str = "texto_livre"
    identificador: Optional[str] = None
    importancia: str = "normal"


@router.post(
    "/bulk",
    response_model=list[Bloco],
    status_code=status.HTTP_201_CREATED,
    summary="Create many blocos in a single atomic transaction",
    description=(
        "Inserts all items inside one database transaction. "
        "If any insert fails the entire batch is rolled back."
    ),
)
async def bulk_create_blocos(items: list[BulkBlocoItem]) -> list[Bloco]:
    if not items:
        return []

    created: list[Bloco] = []
    async with db.pool.acquire() as conn:
        async with conn.transaction():
            for item in items:
                row = await conn.fetchrow(
                    f"""
                    INSERT INTO blocos (documento_id, tipo, identificador,
                                        conteudo, ordem, importancia)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING {_BLOCO_COLS}
                    """,
                    item.documento_id,
                    item.tipo,
                    item.identificador,
                    item.conteudo,
                    item.ordem,
                    item.importancia,
                )
                created.append(Bloco(**dict(row)))

    return created


# ─────────────────────────────────────────────────────────────────────────────
# POST /blocos/reorder — bulk reorder without N round-trips
# ─────────────────────────────────────────────────────────────────────────────

class ReorderItem(BaseModel):
    id: int
    ordem: int


@router.post(
    "/reorder",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Bulk-reorder blocos after a drag-and-drop operation",
    description=(
        "Accepts a list of `{id, ordem}` pairs and applies them in a single "
        "round-trip using `executemany`.  The documento_id is not required "
        "because `id` is globally unique."
    ),
)
async def reorder_blocos(items: list[ReorderItem]) -> None:
    if not items:
        return

    await db.executemany(
        "UPDATE blocos SET ordem = $2 WHERE id = $1",
        [(item.id, item.ordem) for item in items],
    )


# ─────────────────────────────────────────────────────────────────────────────
# POST /blocos/shift-ordem — shift subsequent blocos before inline insert
# ─────────────────────────────────────────────────────────────────────────────

class ShiftOrdemPayload(BaseModel):
    documento_id: int
    from_ordem: int  # inclusive – all blocos with ordem >= from_ordem get +1


@router.post(
    "/shift-ordem",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Shift ordem of subsequent blocos up by 1",
    description=(
        "Before inserting a bloco in the middle of a document, call this to "
        "increment the `ordem` of every bloco whose `ordem >= from_ordem` "
        "within the same documento, making room for the new entry."
    ),
)
async def shift_ordem(payload: ShiftOrdemPayload) -> None:
    await db.execute(
        """
        UPDATE blocos
        SET ordem = ordem + 1
        WHERE documento_id = $1
          AND ordem >= $2
        """,
        payload.documento_id,
        payload.from_ordem,
    )


# ─────────────────────────────────────────────────────────────────────────────
# GET /blocos/search — search blocks and annotations by text (case-insensitive)
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/search",
    summary="Search blocks and annotations by text",
    description="Returns blocks matching the keyword, including their parent document title and folder name.",
)
async def search_blocos(q: str = "") -> list[dict]:
    if not q.strip():
        return []

    term = f"%{q}%"
    rows = await db.fetch(
        """
        SELECT DISTINCT b.id, b.conteudo, d.titulo AS documento_titulo, p.nome AS pasta_nome
        FROM blocos b
        LEFT JOIN documentos d ON b.documento_id = d.id
        LEFT JOIN pastas p ON d.pasta_id = p.id
        LEFT JOIN anotacoes a ON a.bloco_id = b.id
        WHERE b.conteudo ILIKE $1 OR a.conteudo ILIKE $1
        ORDER BY b.id
        LIMIT 20
        """,
        term,
    )

    return [
        {
            "id": r["id"],
            "conteudo": r["conteudo"],
            "documento_titulo": r["documento_titulo"] or "Sem Documento",
            "pasta_nome": r["pasta_nome"] or "Raiz",
        }
        for r in rows
    ]


# ─────────────────────────────────────────────────────────────────────────────
# GET /blocos/{bloco_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/{bloco_id}",
    response_model=Bloco,
    summary="Fetch a single bloco",
)
async def get_bloco(bloco_id: int) -> Bloco:
    row = await db.fetchrow(
        f"SELECT {_BLOCO_COLS} FROM blocos WHERE id = $1",
        bloco_id,
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bloco {bloco_id} não encontrado",
        )
    return Bloco(**dict(row))


# ─────────────────────────────────────────────────────────────────────────────
# PATCH /blocos/{bloco_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.patch(
    "/{bloco_id}",
    response_model=Bloco,
    summary="Partially update a bloco",
    description=(
        "Send **only** the fields you want to change. "
        "Common single-field updates:\n\n"
        "- `{\"importancia\": \"vital\"}` — heatmap annotation\n"
        "- `{\"revisado\": true}` — mark as reviewed\n"
        "- `{\"next_review\": \"2026-06-15\", \"stability\": 4.2, \"reps\": 3}` — FSRS sync\n"
        "- `{\"conteudo\": \"...\"}` — inline edit"
    ),
)
async def patch_bloco(bloco_id: int, payload: BlocoUpdate) -> Bloco:
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nenhum campo fornecido para atualização",
        )

    set_clauses = [f"{col} = ${i + 2}" for i, col in enumerate(updates.keys())]
    values = list(updates.values())

    row = await db.fetchrow(
        f"""
        UPDATE blocos
        SET {", ".join(set_clauses)}
        WHERE id = $1
        RETURNING {_BLOCO_COLS}
        """,
        bloco_id,
        *values,
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bloco {bloco_id} não encontrado",
        )
    return Bloco(**dict(row))


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /blocos/{bloco_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.delete(
    "/{bloco_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a bloco (cascades to anotacoes and portais)",
)
async def delete_bloco(bloco_id: int) -> None:
    status_str = await db.execute(
        "DELETE FROM blocos WHERE id = $1", bloco_id
    )
    if status_str == "DELETE 0":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bloco {bloco_id} não encontrado",
        )
