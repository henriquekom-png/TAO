# TAO Backend – Pydantic models package
# Re-export every schema so consumers can do:
#   from app.models import Pasta, PastaCreate, ...

from .pastas import Pasta, PastaBase, PastaCreate, PastaUpdate
from .documentos import Documento, DocumentoBase, DocumentoCreate, DocumentoUpdate
from .blocos import Bloco, BlocoBase, BlocoCreate, BlocoUpdate
from .anotacoes import Anotacao, AnotacaoBase, AnotacaoCreate, AnotacaoUpdate
from .portais import Portal, PortalBase, PortalCreate
from .materiais import Material, MaterialBase, MaterialCreate, MaterialUpdate
from .questoes import (
    Questao,
    QuestaoBase,
    QuestaoCreate,
    QuestaoUpdate,
    QuestaoItem,
    QuestaoItemBase,
    QuestaoItemCreate,
    QuizResultado,
    QuizResultadoBase,
    QuizResultadoCreate,
)

__all__ = [
    # pastas
    "Pasta", "PastaBase", "PastaCreate", "PastaUpdate",
    # documentos
    "Documento", "DocumentoBase", "DocumentoCreate", "DocumentoUpdate",
    # blocos
    "Bloco", "BlocoBase", "BlocoCreate", "BlocoUpdate",
    # anotacoes
    "Anotacao", "AnotacaoBase", "AnotacaoCreate", "AnotacaoUpdate",
    # portais
    "Portal", "PortalBase", "PortalCreate",
    # materiais
    "Material", "MaterialBase", "MaterialCreate", "MaterialUpdate",
    # questoes / itens / quiz
    "Questao", "QuestaoBase", "QuestaoCreate", "QuestaoUpdate",
    "QuestaoItem", "QuestaoItemBase", "QuestaoItemCreate",
    "QuizResultado", "QuizResultadoBase", "QuizResultadoCreate",
]
