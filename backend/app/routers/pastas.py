"""
Router – /api/v1/pastas
========================

Endpoints
---------
GET  /pastas/tree               → full folder hierarchy (nested JSON)
GET  /pastas/{pasta_id}         → single folder
POST /pastas                    → create a folder
PATCH /pastas/{pasta_id}        → rename / re-parent / reorder
DELETE /pastas/{pasta_id}       → delete (cascades to documentos + blocos)

Tree strategy
-------------
Fetch all rows in ONE query ordered by (nivel, ordem), then build the
nested structure in Python using a dict-of-lists.  For a typical study-app
tree (< 500 nodes) this is always faster than a recursive CTE because it
avoids the planner overhead and multiple round-trips.

If the tree ever grows beyond a few thousand nodes, swap the fetcher for
the recursive CTE in `_fetch_tree_cte()` (stub included at the bottom).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, status

from app.database import db
from app.models.pastas import Pasta, PastaCreate, PastaUpdate

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Response model for the tree endpoint (Pasta + recursive children list)
# ─────────────────────────────────────────────────────────────────────────────

def _build_tree(
    rows: list[dict[str, Any]],
    parent_id: Optional[int] = None,
) -> list[dict[str, Any]]:
    """Recursively nest flat rows into a children-list tree.

    Each node in the returned list is a plain dict with the same fields as
    ``Pasta`` plus a ``children`` key that holds a (possibly empty) list of
    the same structure.
    """
    subtree: list[dict[str, Any]] = []
    for row in rows:
        if row["parent_id"] == parent_id:
            node = dict(row)
            node["children"] = _build_tree(rows, parent_id=row["id"])
            subtree.append(node)
    return subtree


def _records_to_dicts(records: list) -> list[dict[str, Any]]:
    """Convert asyncpg Record objects to plain dicts."""
    return [dict(r) for r in records]


# ─────────────────────────────────────────────────────────────────────────────
# GET /pastas/tree
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/tree",
    summary="Full folder hierarchy",
    response_description="Nested JSON tree of all pastas",
)
async def get_tree() -> list[dict[str, Any]]:
    """Return the complete folder tree as a recursive JSON structure.

    Each node has the same fields as a ``Pasta`` schema row plus a
    ``children`` array that may itself contain further nodes.

    Example leaf node::

        {
          "id": 10,
          "parent_id": 2,
          "nome": "Constituição",
          "nivel": 2,
          "ordem": 1,
          "criado_em": "2026-01-01T00:00:00+00:00",
          "children": []
        }
    """
    rows = await db.fetch(
        "SELECT id, parent_id, nome, nivel, ordem, criado_em "
        "FROM pastas "
        "ORDER BY nivel, ordem"
    )
    flat = _records_to_dicts(rows)
    return _build_tree(flat, parent_id=None)


# ─────────────────────────────────────────────────────────────────────────────
# GET /pastas/{pasta_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/{pasta_id}",
    response_model=Pasta,
    summary="Fetch a single folder",
)
async def get_pasta(pasta_id: int) -> Pasta:
    row = await db.fetchrow(
        "SELECT id, parent_id, nome, nivel, ordem, criado_em "
        "FROM pastas WHERE id = $1",
        pasta_id,
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pasta não encontrada")
    return Pasta(**dict(row))


# ─────────────────────────────────────────────────────────────────────────────
# POST /pastas
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=Pasta,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new folder",
)
async def create_pasta(payload: PastaCreate) -> Pasta:
    # Validate parent exists (if provided)
    if payload.parent_id is not None:
        exists = await db.fetchval(
            "SELECT 1 FROM pastas WHERE id = $1", payload.parent_id
        )
        if not exists:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"parent_id {payload.parent_id} não existe",
            )

    row = await db.fetchrow(
        """
        INSERT INTO pastas (parent_id, nome, nivel, ordem)
        VALUES ($1, $2, $3, $4)
        RETURNING id, parent_id, nome, nivel, ordem, criado_em
        """,
        payload.parent_id,
        payload.nome,
        payload.nivel,
        payload.ordem,
    )
    return Pasta(**dict(row))


# ─────────────────────────────────────────────────────────────────────────────
# PATCH /pastas/{pasta_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.patch(
    "/{pasta_id}",
    response_model=Pasta,
    summary="Rename / re-parent / reorder a folder",
)
async def update_pasta(pasta_id: int, payload: PastaUpdate) -> Pasta:
    # Build SET clause dynamically from the non-None fields in the payload
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
        UPDATE pastas
        SET {", ".join(set_clauses)}
        WHERE id = $1
        RETURNING id, parent_id, nome, nivel, ordem, criado_em
        """,
        pasta_id,
        *values,
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pasta não encontrada")
    return Pasta(**dict(row))


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /pastas/{pasta_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.delete(
    "/{pasta_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a folder (cascades to documents and blocks)",
)
async def delete_pasta(pasta_id: int) -> None:
    status_str = await db.execute(
        "DELETE FROM pastas WHERE id = $1", pasta_id
    )
    # asyncpg returns "DELETE N" where N is the number of rows deleted
    if status_str == "DELETE 0":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pasta não encontrada")


# ─────────────────────────────────────────────────────────────────────────────
# STUB – Recursive CTE alternative (drop-in swap for _build_tree if needed)
# ─────────────────────────────────────────────────────────────────────────────

async def _fetch_tree_cte() -> list[dict[str, Any]]:  # pragma: no cover
    """Alternative: use a PostgreSQL recursive CTE instead of Python nesting.

    Useful if the tree ever grows to thousands of nodes and profiling shows
    the Python dict-walk becoming a bottleneck.

    The query returns one flat row per node with a JSON ``path`` array that
    the frontend can use to reconstruct the tree without another round-trip.
    """
    rows = await db.fetch(
        """
        WITH RECURSIVE tree AS (
            SELECT id, parent_id, nome, nivel, ordem, criado_em,
                   ARRAY[id] AS path
            FROM pastas
            WHERE parent_id IS NULL

            UNION ALL

            SELECT p.id, p.parent_id, p.nome, p.nivel, p.ordem, p.criado_em,
                   t.path || p.id
            FROM pastas p
            JOIN tree t ON p.parent_id = t.id
        )
        SELECT * FROM tree ORDER BY path
        """
    )
    return _records_to_dicts(rows)
