"""
Pydantic v2 schemas – anotacoes
Mirrors the SQL table:

    CREATE TABLE anotacoes (
        id          INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        bloco_id    INTEGER NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
        tipo        TEXT    NOT NULL DEFAULT 'texto'
                        CHECK(tipo IN ('texto','tabela','fluxograma','portal')),
        conteudo    TEXT    NOT NULL DEFAULT '',
        ordem       INTEGER NOT NULL DEFAULT 0,
        criado_em   TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
    );
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

TipoAnotacaoType = Literal["texto", "tabela", "fluxograma", "portal"]


class AnotacaoBase(BaseModel):
    bloco_id: int = Field(..., description="FK → blocos.id")
    tipo: TipoAnotacaoType = Field("texto", description="Tipo de anotação")
    conteudo: str = Field("", description="Conteúdo (markdown, JSON de tabela, etc.)")
    ordem: int = Field(0, ge=0)


class AnotacaoCreate(AnotacaoBase):
    pass


class AnotacaoUpdate(BaseModel):
    bloco_id: Optional[int] = None
    tipo: Optional[TipoAnotacaoType] = None
    conteudo: Optional[str] = None
    ordem: Optional[int] = Field(None, ge=0)


class Anotacao(AnotacaoBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    criado_em: Optional[datetime] = None
    atualizado_em: Optional[datetime] = None
