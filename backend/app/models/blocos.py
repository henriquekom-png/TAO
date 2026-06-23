"""
Pydantic v2 schemas – blocos
Mirrors the SQL table (abbreviated):

    CREATE TABLE blocos (
        id              INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        documento_id    INTEGER NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
        tipo            TEXT    NOT NULL DEFAULT 'texto_livre'
                            CHECK(tipo IN ('artigo','paragrafo','inciso','alinea','cabecalho','texto_livre')),
        identificador   TEXT,
        conteudo        TEXT    NOT NULL DEFAULT '',
        ordem           INTEGER NOT NULL DEFAULT 0,
        importancia     TEXT    NOT NULL DEFAULT 'normal'
                            CHECK(importancia IN ('normal','importante','vital')),
        cor_fonte       TEXT    NOT NULL DEFAULT 'preto',
        alinhamento     TEXT    NOT NULL DEFAULT 'justificado',
        revisado        BOOLEAN NOT NULL DEFAULT FALSE,
        last_review     DATE,
        next_review     DATE,
        stability       DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        difficulty      DOUBLE PRECISION NOT NULL DEFAULT 0.3,
        reps            INTEGER NOT NULL DEFAULT 0,
        lapses          INTEGER NOT NULL DEFAULT 0,
        chroma_synced   BOOLEAN NOT NULL DEFAULT FALSE,
        chroma_id       TEXT,
        criado_em       TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em   TIMESTAMPTZ DEFAULT NOW()
        -- fts_vector  tsvector GENERATED (excluded – server-side only)
    );
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# ── Constrained string literals matching the DB CHECK constraints ──────────
TipoBlocoType = Literal["artigo", "paragrafo", "inciso", "alinea", "cabecalho", "texto_livre"]
ImportanciaType = Literal["normal", "importante", "vital"]


class BlocoBase(BaseModel):
    documento_id: str = Field(..., description="FK → documentos.id")
    tipo: TipoBlocoType = Field("texto_livre", description="Tipo estrutural do bloco")
    identificador: Optional[str] = Field(None, description="Ex.: 'Art. 5º', 'I', 'a)'")
    conteudo: str = Field("", description="Conteúdo textual do bloco")
    ordem: int = Field(0, ge=0)

    # Heatmap
    importancia: ImportanciaType = Field("normal")

    # Formatação visual
    cor_fonte: str = Field("preto", max_length=50)
    alinhamento: str = Field("justificado", max_length=50)

    # FSRS
    revisado: bool = Field(False)
    last_review: Optional[date] = None
    next_review: Optional[date] = None
    stability: float = Field(1.0, ge=0.0)
    difficulty: float = Field(0.3, ge=0.0, le=1.0)
    reps: int = Field(0, ge=0)
    lapses: int = Field(0, ge=0)

    # ChromaDB
    chroma_synced: bool = Field(False)
    chroma_id: Optional[str] = None


class BlocoCreate(BlocoBase):
    pass


class BlocoUpdate(BaseModel):
    """All fields optional – send only what changes."""
    documento_id: Optional[str] = None
    tipo: Optional[TipoBlocoType] = None
    identificador: Optional[str] = None
    conteudo: Optional[str] = None
    ordem: Optional[int] = Field(None, ge=0)
    importancia: Optional[ImportanciaType] = None
    cor_fonte: Optional[str] = Field(None, max_length=50)
    alinhamento: Optional[str] = Field(None, max_length=50)
    revisado: Optional[bool] = None
    last_review: Optional[date] = None
    next_review: Optional[date] = None
    stability: Optional[float] = Field(None, ge=0.0)
    difficulty: Optional[float] = Field(None, ge=0.0, le=1.0)
    reps: Optional[int] = Field(None, ge=0)
    lapses: Optional[int] = Field(None, ge=0)
    chroma_synced: Optional[bool] = None
    chroma_id: Optional[str] = None


class Bloco(BlocoBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    criado_em: Optional[datetime] = None
    atualizado_em: Optional[datetime] = None
    # fts_vector is a server-side tsvector; never sent over the API
