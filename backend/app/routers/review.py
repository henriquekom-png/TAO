"""
Router – /api/v1/review
========================

POST /review/{bloco_id}
    Accept a grade (1–4 or "again"|"hard"|"good"|"easy"), run FSRS v5,
    and write the updated card state back to the ``blocos`` table.

POST /review/due
    Return all blocos whose ``next_review <= today`` (the review queue).
"""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional, Union

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.database import db
from app.services import fsrs_service
from app.models.blocos import Bloco

router = APIRouter()

# ── Request / Response models ─────────────────────────────────────────────────

class ReviewRequest(BaseModel):
    """Body for POST /review/{bloco_id}."""

    grade: Union[
        Literal["again", "hard", "good", "easy"],
        Literal[1, 2, 3, 4],
    ] = Field(
        ...,
        description=(
            "Review grade — string (again|hard|good|easy) "
            "or integer (1=Again, 2=Hard, 3=Good, 4=Easy)"
        ),
        examples=["good", 3],
    )


class ReviewResponse(BaseModel):
    """Response body after a successful review."""

    bloco_id: int
    stability:   float
    difficulty:  float
    reps:        int
    lapses:      int
    last_review: str     # YYYY-MM-DD
    next_review: str     # YYYY-MM-DD
    urgency:     str     # 🟢 / 🟡 / 🔴 / ⬜


class DueBloco(BaseModel):
    """Minimal bloco info returned by /review/due."""

    id: str
    documento_id: int
    identificador: Optional[str]
    conteudo:     str
    importancia:  str
    next_review:  Optional[str]
    urgency:      str


# ── Helpers ───────────────────────────────────────────────────────────────────

_BLOCO_COLS = """
    id, documento_id, tipo, identificador, conteudo, ordem,
    importancia, cor_fonte, alinhamento,
    revisado, last_review, next_review,
    stability, difficulty, reps, lapses,
    chroma_synced, chroma_id,
    criado_em, atualizado_em
"""


async def _fetch_bloco_or_404(bloco_id: int) -> dict:
    row = await db.fetchrow(
        f"SELECT {_BLOCO_COLS} FROM blocos WHERE id = $1", bloco_id
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bloco {bloco_id} não encontrado",
        )
    return dict(row)


# ── POST /review/{bloco_id} ───────────────────────────────────────────────────

@router.post(
    "/{bloco_id}",
    response_model=ReviewResponse,
    summary="Submit a review grade and update FSRS state",
    description=(
        "Accepts a grade (1–4 or string alias), runs the FSRS v5 scheduler, "
        "and writes ``stability``, ``difficulty``, ``reps``, ``lapses``, "
        "``last_review``, ``next_review``, and ``revisado=true`` back to the DB."
    ),
)
async def submit_review(bloco_id: int, body: ReviewRequest) -> ReviewResponse:
    bloco  = await _fetch_bloco_or_404(bloco_id)
    result = fsrs_service.schedule_review(bloco, body.grade)  # type: ignore[arg-type]

    await db.execute(
        """
        UPDATE blocos
        SET
            stability   = $2,
            difficulty  = $3,
            reps        = $4,
            lapses      = $5,
            last_review = $6,
            next_review = $7,
            revisado    = TRUE
        WHERE id = $1
        """,
        bloco_id,
        result.stability,
        result.difficulty,
        result.reps,
        result.lapses,
        result.last_review,   # asyncpg accepts ISO date strings for DATE columns
        result.next_review,
    )

    return ReviewResponse(
        bloco_id    = bloco_id,
        stability   = result.stability,
        difficulty  = result.difficulty,
        reps        = result.reps,
        lapses      = result.lapses,
        last_review = result.last_review,
        next_review = result.next_review,
        urgency     = fsrs_service.urgency_dot(result.next_review),
    )


# ── POST /review/due ──────────────────────────────────────────────────────────

@router.get(
    "/due",
    response_model=list[DueBloco],
    summary="Fetch today's review queue",
    description=(
        "Returns all blocos with ``next_review <= today`` ordered by urgency "
        "(most overdue first). Only blocos that have been reviewed at least "
        "once (``reps > 0``) are included."
    ),
)
async def get_due_queue() -> list[DueBloco]:
    today = str(date.today())
    rows  = await db.fetch(
        """
        SELECT id, documento_id, identificador, conteudo, importancia, next_review
        FROM blocos
        WHERE next_review <= $1
          AND reps > 0
        ORDER BY next_review ASC
        LIMIT 200
        """,
        today,
    )
    return [
        DueBloco(
            id            = r["id"],
            documento_id  = r["documento_id"],
            identificador = r["identificador"],
            conteudo      = r["conteudo"],
            importancia   = r["importancia"],
            next_review   = str(r["next_review"]) if r["next_review"] else None,
            urgency       = fsrs_service.urgency_dot(r["next_review"]),
        )
        for r in rows
    ]
