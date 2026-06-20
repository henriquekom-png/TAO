"""
Pydantic v2 schemas – documentos
Mirrors the SQL table:

    CREATE TABLE documentos (
        id            INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        pasta_id      INTEGER NOT NULL REFERENCES pastas(id) ON DELETE CASCADE,
        titulo        TEXT    NOT NULL,
        descricao     TEXT,
        ordem         INTEGER NOT NULL DEFAULT 0,
        criado_em     TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
    );
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class DocumentoBase(BaseModel):
    pasta_id: str = Field(..., description="FK → pastas.id")
    titulo: str = Field(..., min_length=1, max_length=512, description="Título do documento")
    descricao: Optional[str] = Field(None, description="Descrição opcional")
    ordem: float = Field(0.0, description="Posição na sidebar dentro da pasta")


class DocumentoCreate(DocumentoBase):
    pass


class DocumentoUpdate(BaseModel):
    pasta_id: Optional[str] = None
    titulo: Optional[str] = Field(None, min_length=1, max_length=512)
    descricao: Optional[str] = None
    ordem: Optional[float] = None


class Documento(DocumentoBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    criado_em: Optional[datetime] = None
    atualizado_em: Optional[datetime] = None
