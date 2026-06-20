import logging
import uuid
from typing import List
from fastapi import APIRouter, HTTPException, status
from app.database import db
from app.models.anotacoes import Anotacao, AnotacaoCreate, AnotacaoUpdate

logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/bloco/{bloco_id}", response_model=List[Anotacao])
async def get_anotacoes_by_bloco(bloco_id: str) -> List[Anotacao]:
    rows = await db.fetch(
        """
        SELECT id, bloco_id, tipo, conteudo, ordem, criado_em, atualizado_em
        FROM anotacoes
        WHERE bloco_id = $1
        ORDER BY ordem ASC, id ASC
        """,
        bloco_id
    )
    return [Anotacao(**dict(r)) for r in rows]

@router.get("/documento/{documento_id}", response_model=List[Anotacao])
async def get_anotacoes_by_documento(documento_id: str) -> List[Anotacao]:
    rows = await db.fetch(
        """
        SELECT a.id, a.bloco_id, a.tipo, a.conteudo, a.ordem, a.criado_em, a.atualizado_em
        FROM anotacoes a
        JOIN blocos b ON a.bloco_id = b.id
        WHERE b.documento_id = $1
        ORDER BY a.ordem ASC, a.id ASC
        """,
        documento_id
    )
    return [Anotacao(**dict(r)) for r in rows]

@router.post("/", response_model=Anotacao, status_code=status.HTTP_201_CREATED)
async def create_anotacao(payload: AnotacaoCreate) -> Anotacao:
    try:
        new_id = str(uuid.uuid4())
        row = await db.fetchrow(
            """
            INSERT INTO anotacoes (id, bloco_id, tipo, conteudo, ordem)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, bloco_id, tipo, conteudo, ordem, criado_em, atualizado_em
            """,
            new_id, payload.bloco_id, payload.tipo, payload.conteudo, payload.ordem
        )
        return Anotacao(**dict(row))
    except Exception as e:
        logger.exception("Erro ao criar anotação: %s", e)
        raise HTTPException(status_code=500, detail=f"Erro ao criar anotação: {e}")

@router.patch("/{anotacao_id}", response_model=Anotacao)
async def update_anotacao(anotacao_id: str, payload: AnotacaoUpdate) -> Anotacao:
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")

    set_clauses = [f"{col} = ${i + 2}" for i, col in enumerate(updates.keys())]
    values = list(updates.values())

    row = await db.fetchrow(
        f"""
        UPDATE anotacoes
        SET {", ".join(set_clauses)}
        WHERE id = $1
        RETURNING id, bloco_id, tipo, conteudo, ordem, criado_em, atualizado_em
        """,
        anotacao_id, *values
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Anotação não encontrada")
    return Anotacao(**dict(row))

@router.delete("/{anotacao_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_anotacao(anotacao_id: str) -> None:
    # Check if the annotation exists first, then delete
    existing = await db.fetchrow(
        "SELECT id FROM anotacoes WHERE id = $1",
        anotacao_id
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Anotação não encontrada")
    await db.execute("DELETE FROM anotacoes WHERE id = $1", anotacao_id)



from pydantic import BaseModel  # local import keeps top clean

class ReorderAnotacaoItem(BaseModel):
    id: str
    ordem: int

@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT, summary="Bulk-reorder anotacoes")
async def reorder_anotacoes(items: list[ReorderAnotacaoItem]) -> None:
    if not items:
        return
    await db.executemany(
        "UPDATE anotacoes SET ordem = $2 WHERE id = $1",
        [(item.id, item.ordem) for item in items],
    )

