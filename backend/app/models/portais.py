"""
Pydantic v2 schemas – portais
Mirrors the SQL table:

    CREATE TABLE portais (
        id                INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        bloco_origem_id   INTEGER NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
        bloco_alvo_id     INTEGER NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
        criado_em         TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(bloco_origem_id, bloco_alvo_id)
    );
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PortalBase(BaseModel):
    bloco_origem_id: str = Field(..., description="Bloco de origem do portal")
    bloco_alvo_id: str = Field(..., description="Bloco de destino do portal")

    @model_validator(mode="after")
    def origem_diferente_de_alvo(self) -> "PortalBase":
        if self.bloco_origem_id == self.bloco_alvo_id:
            raise ValueError("bloco_origem_id e bloco_alvo_id não podem ser iguais")
        return self


class PortalCreate(PortalBase):
    pass


class Portal(PortalBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    criado_em: Optional[datetime] = None
