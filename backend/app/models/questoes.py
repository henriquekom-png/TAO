"""
Pydantic v2 schemas – questoes, questao_itens, quiz_resultados
Mirrors the SQL tables:

    CREATE TABLE questoes (
        id              INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        banca           TEXT,
        ano             INTEGER,
        cargo           TEXT,
        materia         TEXT NOT NULL DEFAULT '',
        tipo            TEXT NOT NULL DEFAULT 'multipla_escolha'
                            CHECK(tipo IN ('multipla_escolha','certo_errado','combinacao_itens')),
        enunciado       TEXT NOT NULL,
        alternativa_a   TEXT, alternativa_b TEXT, alternativa_c TEXT,
        alternativa_d   TEXT, alternativa_e TEXT,
        gabarito        TEXT NOT NULL,
        comentario      TEXT,
        dificuldade     TEXT NOT NULL DEFAULT 'media'
                            CHECK(dificuldade IN ('facil','media','dificil')),
        bloco_origem_id INTEGER REFERENCES blocos(id) ON DELETE SET NULL,
        criado_em       TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE questao_itens (
        id         INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        questao_id INTEGER NOT NULL REFERENCES questoes(id) ON DELETE CASCADE,
        numero     TEXT NOT NULL,
        enunciado  TEXT NOT NULL,
        correto    BOOLEAN DEFAULT NULL,
        ordem      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE quiz_resultados (
        id            INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        questao_id    INTEGER REFERENCES questoes(id) ON DELETE CASCADE,
        acertou       BOOLEAN NOT NULL,
        respondido_em TIMESTAMPTZ DEFAULT NOW()
    );
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# ── Questão ────────────────────────────────────────────────────────────────

TipoQuestaoType = Literal["multipla_escolha", "certo_errado", "combinacao_itens"]
DificuldadeType = Literal["facil", "media", "dificil"]


class QuestaoBase(BaseModel):
    banca: Optional[str] = Field(None, max_length=100)
    ano: Optional[int] = Field(None, ge=1900, le=2100)
    cargo: Optional[str] = Field(None, max_length=255)
    materia: str = Field("", max_length=255)
    tipo: TipoQuestaoType = Field("multipla_escolha")
    enunciado: str = Field(..., min_length=1)
    alternativa_a: Optional[str] = None
    alternativa_b: Optional[str] = None
    alternativa_c: Optional[str] = None
    alternativa_d: Optional[str] = None
    alternativa_e: Optional[str] = None
    gabarito: str = Field(..., min_length=1, max_length=500)
    comentario: Optional[str] = None
    dificuldade: DificuldadeType = Field("media")
    bloco_origem_id: Optional[str] = Field(None, description="FK → blocos.id (nullable)")


class QuestaoCreate(QuestaoBase):
    pass


class QuestaoItemInline(BaseModel):
    numero: str = Field(..., min_length=1, max_length=20)
    enunciado: str = Field(..., min_length=1)
    correto: Optional[bool] = None
    ordem: int = 0


class QuestaoUpdate(BaseModel):
    banca: Optional[str] = Field(None, max_length=100)
    ano: Optional[int] = Field(None, ge=1900, le=2100)
    cargo: Optional[str] = Field(None, max_length=255)
    materia: Optional[str] = Field(None, max_length=255)
    tipo: Optional[TipoQuestaoType] = None
    enunciado: Optional[str] = Field(None, min_length=1)
    alternativa_a: Optional[str] = None
    alternativa_b: Optional[str] = None
    alternativa_c: Optional[str] = None
    alternativa_d: Optional[str] = None
    alternativa_e: Optional[str] = None
    gabarito: Optional[str] = Field(None, min_length=1, max_length=50)
    comentario: Optional[str] = None
    dificuldade: Optional[DificuldadeType] = None
    bloco_origem_id: Optional[str] = None
    itens: Optional[list[QuestaoItemInline]] = None


class Questao(QuestaoBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    criado_em: Optional[datetime] = None


class QuestaoComItens(Questao):
    """Questao enriched with its questao_itens rows (used in GET /quiz/session)."""

    itens: list["QuestaoItem"] = Field(default_factory=list)


# ── QuestaoItem ────────────────────────────────────────────────────────────

class QuestaoItemBase(BaseModel):
    questao_id: str = Field(..., description="FK → questoes.id")
    numero: str = Field(..., min_length=1, max_length=20, description="Ex.: 'I', 'II', 'a)'")
    enunciado: str = Field(..., min_length=1)
    correto: Optional[bool] = Field(None, description="NULL = não gabaritado ainda")
    ordem: int = Field(0, ge=0)


class QuestaoItemCreate(QuestaoItemBase):
    pass


class QuestaoItem(QuestaoItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: str


# ── QuizResultado ──────────────────────────────────────────────────────────

class QuizResultadoBase(BaseModel):
    questao_id: Optional[str] = Field(None, description="FK → questoes.id (nullable on cascade)")
    acertou: bool = Field(..., description="True = acertou, False = errou")


class QuizResultadoCreate(QuizResultadoBase):
    pass


class QuizResultado(QuizResultadoBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    respondido_em: Optional[datetime] = None


# ── Ingestão ───────────────────────────────────────────────────────────────

class IngestPayload(BaseModel):
    """Payload for POST /api/v1/questoes/ingest."""

    texto: str = Field(..., min_length=10, description="Markdown or JSON text containing one or more questions.")
    formato: Literal["markdown", "json"] = Field("markdown", description="Hint about the text format.")


class IngestResult(BaseModel):
    """Response model for POST /api/v1/questoes/ingest."""

    criadas: int = Field(..., description="Number of questions successfully created.")
    questoes: list[Questao] = Field(default_factory=list)

