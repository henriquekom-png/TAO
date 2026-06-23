"""
Pydantic v2 schemas – pastas
Mirrors the SQL table:

    CREATE TABLE pastas (
        id        INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        parent_id INTEGER REFERENCES pastas(id) ON DELETE CASCADE,
        nome      TEXT    NOT NULL,
        nivel     INTEGER NOT NULL DEFAULT 0,
        ordem     INTEGER NOT NULL DEFAULT 0,
        criado_em TIMESTAMPTZ DEFAULT NOW()
    );
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Base — shared fields that appear in both CREATE and DB-read payloads
# ---------------------------------------------------------------------------
class PastaBase(BaseModel):
    parent_id: Optional[str] = Field(None, description="ID da pasta pai (NULL = raiz)")
    nome: str = Field(..., min_length=1, max_length=255, description="Nome da pasta")
    nivel: int = Field(0, ge=0, description="Profundidade na árvore (raiz = 0)")
    ordem: float = Field(0.0, description="Posição de exibição entre irmãos")


# ---------------------------------------------------------------------------
# Create — payload accepted by POST /pastas
# ---------------------------------------------------------------------------
class PastaCreate(PastaBase):
    pass


# ---------------------------------------------------------------------------
# Update — payload accepted by PATCH /pastas/{id}  (all fields optional)
# ---------------------------------------------------------------------------
class PastaUpdate(BaseModel):
    parent_id: Optional[str] = None
    nome: Optional[str] = Field(None, min_length=1, max_length=255)
    nivel: Optional[int] = Field(None, ge=0)
    ordem: Optional[float] = None


# ---------------------------------------------------------------------------
# DB read — full row returned by SELECT queries
# ---------------------------------------------------------------------------
class Pasta(PastaBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    criado_em: Optional[datetime] = None
