"""
Pydantic v2 schemas – materiais
Mirrors the SQL table:

    CREATE TABLE materiais (
        id              INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        nome_arquivo    TEXT    NOT NULL,
        tipo            TEXT    NOT NULL CHECK(tipo IN ('pdf','docx','txt')),
        caminho         TEXT    NOT NULL UNIQUE,
        tamanho_bytes   INTEGER,
        chroma_synced   BOOLEAN NOT NULL DEFAULT FALSE,
        criado_em       TIMESTAMPTZ DEFAULT NOW()
    );
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

TipoMaterialType = Literal["pdf", "docx", "txt"]


class MaterialBase(BaseModel):
    nome_arquivo: str = Field(..., min_length=1, max_length=512)
    tipo: TipoMaterialType = Field(..., description="Extensão/tipo do arquivo")
    caminho: str = Field(..., description="Caminho único no servidor/bucket")
    tamanho_bytes: Optional[int] = Field(None, ge=0)
    chroma_synced: bool = Field(False)


class MaterialCreate(MaterialBase):
    pass


class MaterialUpdate(BaseModel):
    nome_arquivo: Optional[str] = Field(None, min_length=1, max_length=512)
    tipo: Optional[TipoMaterialType] = None
    caminho: Optional[str] = None
    tamanho_bytes: Optional[int] = Field(None, ge=0)
    chroma_synced: Optional[bool] = None


class Material(MaterialBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    criado_em: Optional[datetime] = None
