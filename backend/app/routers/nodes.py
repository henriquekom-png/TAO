"""
Router – /api/v1/nodes
======================

Endpoints
---------
POST /nodes/resolve-portals  → batch-resolve portal references ((id))
"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Union
import uuid

from app.database import db

router = APIRouter()


class PortalNestedAnotacao(BaseModel):
    id: str
    tipo: str
    conteudo: str
    ordem: int


class ResolvedPortal(BaseModel):
    kind: Literal["anotacao", "bloco"]
    id: str
    conteudo: str
    bloco_id: str
    documento_id: str
    pasta_id: str
    documento_titulo: str
    identificador: Optional[str] = None
    pasta_path: list[str] = Field(default_factory=list)
    anotacoes: list[PortalNestedAnotacao] = Field(default_factory=list)
    found: bool = True


class ResolvePortalsRequest(BaseModel):
    ids: list[Union[str, int]]


class ResolvePortalsResponse(BaseModel):
    resolved: dict[str, ResolvedPortal]


async def _build_pasta_path(pasta_id: str) -> list[str]:
    """Return ancestor pasta IDs from root → target (inclusive)."""
    rows = await db.fetch("SELECT id, parent_id FROM pastas")
    by_id = {r["id"]: r["parent_id"] for r in rows}

    path: list[str] = []
    current: Optional[str] = pasta_id
    visited: set[str] = set()
    while current is not None and current not in visited:
        visited.add(current)
        path.append(current)
        current = by_id.get(current)
    path.reverse()
    return path


@router.post(
    "/resolve-portals",
    response_model=ResolvePortalsResponse,
    summary="Resolve portal references by ID",
    description=(
        "Accepts a list of numeric IDs referenced via `((id))` syntax. "
        "Each ID is resolved as an **anotação** first; if not found, as a **bloco**. "
        "Block resolutions include nested anotações for transclusion display."
    ),
)
async def resolve_portals(payload: ResolvePortalsRequest) -> ResolvePortalsResponse:
    if not payload.ids:
        return ResolvePortalsResponse(resolved={})

    unique_ids = list(dict.fromkeys([str(i) for i in payload.ids]))
    valid_uuids = []
    invalid_ids = []
    for i in unique_ids:
        try:
            uuid.UUID(str(i))
            valid_uuids.append(i)
        except ValueError:
            invalid_ids.append(i)

    resolved: dict[str, ResolvedPortal] = {}

    for bid in invalid_ids:
        resolved[str(bid)] = ResolvedPortal(
            kind="bloco",
            id=bid,
            conteudo="⚠️ Portal quebrado: O ID numérico deste portal não é mais válido devido à migração arquitetural para UUIDs. Por favor, re-crie este portal.",
            bloco_id="",
            documento_id="",
            pasta_id="",
            documento_titulo="Referência Perdida",
            pasta_path=[],
            anotacoes=[],
            found=False,
        )

    if not valid_uuids:
        return ResolvePortalsResponse(resolved=resolved)

    # ── 1. Try as anotação IDs ───────────────────────────────────────────────
    anot_rows = await db.fetch(
        """
        SELECT a.id, a.tipo, a.conteudo, a.ordem, a.bloco_id,
               b.documento_id, b.identificador AS bloco_identificador,
               d.pasta_id, d.titulo AS documento_titulo
        FROM anotacoes a
        JOIN blocos b ON b.id = a.bloco_id
        JOIN documentos d ON d.id = b.documento_id
        WHERE a.id = ANY($1::uuid[])
        """,
        valid_uuids,
    )
    anot_by_id = {r["id"]: r for r in anot_rows}

    remaining = [i for i in valid_uuids if i not in anot_by_id]

    for aid, row in anot_by_id.items():
        pasta_path = await _build_pasta_path(row["pasta_id"])
        resolved[str(aid)] = ResolvedPortal(
            kind="anotacao",
            id=aid,
            conteudo=row["conteudo"] or "",
            bloco_id=row["bloco_id"],
            documento_id=row["documento_id"],
            pasta_id=row["pasta_id"],
            documento_titulo=row["documento_titulo"],
            identificador=row["bloco_identificador"],
            pasta_path=pasta_path,
            anotacoes=[],
            found=True,
        )

    # ── 2. Try remaining as bloco IDs ───────────────────────────────────────
    if remaining:
        bloco_rows = await db.fetch(
            """
            SELECT b.id, b.conteudo, b.identificador,
                   b.documento_id, d.pasta_id, d.titulo AS documento_titulo
            FROM blocos b
            JOIN documentos d ON d.id = b.documento_id
            WHERE b.id = ANY($1::uuid[])
            """,
            remaining,
        )
        bloco_by_id = {r["id"]: r for r in bloco_rows}



        for bid in remaining:
            row = bloco_by_id.get(bid)
            if row is None:
                resolved[str(bid)] = ResolvedPortal(
                    kind="bloco",
                    id=bid,
                    conteudo="",
                    bloco_id=bid,
                    documento_id="",
                    pasta_id="",
                    documento_titulo="",
                    pasta_path=[],
                    anotacoes=[],
                    found=False,
                )
                continue

            pasta_path = await _build_pasta_path(row["pasta_id"])
            resolved[str(bid)] = ResolvedPortal(
                kind="bloco",
                id=bid,
                conteudo=row["conteudo"] or "",
                bloco_id=bid,
                documento_id=row["documento_id"],
                pasta_id=row["pasta_id"],
                documento_titulo=row["documento_titulo"],
                identificador=row["identificador"],
                pasta_path=pasta_path,
                anotacoes=[],
                found=True,
            )

    return ResolvePortalsResponse(resolved=resolved)
