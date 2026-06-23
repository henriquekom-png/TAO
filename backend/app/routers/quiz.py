"""
Router – /api/v1/quiz
=====================

Endpoints for quiz session retrieval and result recording.

Routes:
    GET  /session  — Fetch randomised questions with optional filters.
                     For tipo='combinacao_itens', questao_itens are nested
                     in the response as { ..., itens: [...] }.
    POST /results  — Record whether the user answered correctly.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.database import db
from app.models.questoes import QuestaoComItens, QuizResultado, QuizResultadoCreate

logger = logging.getLogger(__name__)
router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# GET /session
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/session",
    response_model=List[QuestaoComItens],
    summary="Fetch a randomised set of questions for a quiz session",
)
async def get_quiz_session(
    materia:    Optional[str] = None,
    banca:      Optional[str] = None,
    ano:        Optional[int] = None,
    cargo:      Optional[str] = None,
    dificuldade: Optional[str] = None,
    limit:      int = 10,
):
    """
    Returns `limit` questions (default 10, max 50) in random order.
    Applies optional column-equality filters via query parameters.
    For questions of tipo='combinacao_itens', the response includes
    a nested `itens` array populated from the `questao_itens` table.
    """
    limit = min(limit, 50)

    # Build WHERE clauses dynamically — only for provided filters
    filters: list[str] = []
    args: list = []

    def _add(col: str, val):
        args.append(val)
        filters.append(f"{col} = ${len(args)}")

    if materia:
        _add("materia", materia)
    if banca:
        _add("banca", banca)
    if ano:
        _add("ano", ano)
    if cargo:
        _add("cargo", cargo)
    if dificuldade:
        _add("dificuldade", dificuldade)

    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
    args.append(limit)
    limit_placeholder = f"${len(args)}"

    query = f"""
        SELECT * FROM questoes
        {where_clause}
        ORDER BY RANDOM()
        LIMIT {limit_placeholder}
    """

    rows = await db.fetch(query, *args)

    if not rows:
        return []

    # Hydrate questao_itens for combinacao_itens rows in a single batch query
    questao_ids = [r["id"] for r in rows if r["tipo"] == "combinacao_itens"]
    itens_map: dict[int, list[dict]] = {}

    if questao_ids:
        placeholders = ", ".join(f"${i+1}" for i in range(len(questao_ids)))
        itens_rows = await db.fetch(
            f"""
            SELECT * FROM questao_itens
            WHERE questao_id IN ({placeholders})
            ORDER BY questao_id, ordem, id
            """,
            *questao_ids,
        )
        for item in itens_rows:
            qid = item["questao_id"]
            itens_map.setdefault(qid, []).append(dict(item))

    # Assemble response
    result: list[QuestaoComItens] = []
    for row in rows:
        data = dict(row)
        data["itens"] = itens_map.get(data["id"], [])
        result.append(QuestaoComItens(**data))

    return result


# ─────────────────────────────────────────────────────────────────────────────
# POST /results
# ─────────────────────────────────────────────────────────────────────────────

class ResultPayload(BaseModel):
    questao_id: int  = Field(..., description="FK → questoes.id")
    acertou:    bool = Field(..., description="True if the user answered correctly")


@router.post(
    "/results",
    response_model=QuizResultado,
    status_code=status.HTTP_201_CREATED,
    summary="Record a quiz answer result",
)
async def post_quiz_result(body: ResultPayload):
    """
    Inserts a row into quiz_resultados.
    `respondido_em` is set by the database DEFAULT NOW(), not passed by the client.
    This endpoint should be called fire-and-forget from the frontend (non-blocking).
    """
    try:
        # If the questao_id is negative (e.g. "-1"), it's a temporary AI-generated question.
        # We should NOT attempt to save it in the database. Just mock a success response.
        if body.questao_id.startswith("-"):
            return QuizResultado(
                id="temp-" + body.questao_id.lstrip("-"),
                questao_id=body.questao_id,
                acertou=body.acertou,
                respondido_em=None
            )

        new_id = await db.fetchval(
            """
            INSERT INTO quiz_resultados (questao_id, acertou)
            VALUES ($1, $2)
            RETURNING id
            """,
            body.questao_id,
            body.acertou,
        )
        row = await db.fetchrow(
            "SELECT * FROM quiz_resultados WHERE id = $1", new_id
        )
        return QuizResultado(**dict(row))
    except Exception as exc:
        logger.error("Erro ao registrar resultado do quiz: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Falha ao registrar resultado: {exc}",
        )
