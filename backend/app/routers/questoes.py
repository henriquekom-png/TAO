"""
Router – /api/v1/questoes
=========================

Endpoints for the question bank (banco de questões).
Includes AI generation (POST /generate) and bulk ingestion (POST /ingest).
"""

from __future__ import annotations

import json
import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.database import db
from app.models.questoes import (
    Questao,
    QuestaoCreate,
    QuestaoUpdate,
    QuestaoComItens,
    QuestaoItem,
    IngestPayload,
    IngestResult,
)
from app.services import ai_service

logger = logging.getLogger(__name__)
router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _fetch_with_itens(questao_id: str) -> QuestaoComItens:
    """Fetch a questao row and attach its questao_itens (if any)."""
    row = await db.fetchrow("SELECT * FROM questoes WHERE id = $1", questao_id)
    if not row:
        raise HTTPException(status_code=404, detail="Questão não encontrada")
    data = dict(row)
    if data.get("tipo") == "combinacao_itens":
        itens_rows = await db.fetch(
            "SELECT * FROM questao_itens WHERE questao_id = $1 ORDER BY ordem, id",
            questao_id,
        )
        data["itens"] = [dict(r) for r in itens_rows]
    else:
        data["itens"] = []
    return QuestaoComItens(**data)


async def _insert_questao(q: QuestaoCreate) -> int:
    """Insert a QuestaoCreate into the DB and return the new id."""
    new_id = await db.fetchval(
        """
        INSERT INTO questoes (
            banca, ano, cargo, materia, tipo, enunciado,
            alternativa_a, alternativa_b, alternativa_c,
            alternativa_d, alternativa_e,
            gabarito, comentario, dificuldade, bloco_origem_id
        ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, $13, $14, $15
        ) RETURNING id
        """,
        q.banca,
        q.ano,
        q.cargo,
        q.materia,
        q.tipo,
        q.enunciado,
        q.alternativa_a,
        q.alternativa_b,
        q.alternativa_c,
        q.alternativa_d,
        q.alternativa_e,
        q.gabarito,
        q.comentario,
        q.dificuldade,
        q.bloco_origem_id,
    )
    return new_id


# ─────────────────────────────────────────────────────────────────────────────
# GET /  — list questoes (with pagination, search, and filters)
# ─────────────────────────────────────────────────────────────────────────────

class PaginatedQuestoes(BaseModel):
    total: int
    page: int
    limit: int
    data: List[Questao]


@router.get("/", response_model=PaginatedQuestoes)
async def list_questoes(
    page:      int           = 1,
    limit:     int           = 20,
    materia:   Optional[str] = None,
    banca:     Optional[str] = None,
    tipo:      Optional[str] = None,
    dificuldade: Optional[str] = None,
    search:    Optional[str] = None,
    bloco_id: Optional[str] = None,
):
    """
    Fetch questions from the bank with pagination and optional filters.

    - search: free-text match against enunciado (ILIKE)
    - materia / banca / tipo / dificuldade: exact column equality
    - bloco_id: filter by bloco_origem_id
    - page / limit: offset pagination (page starts at 1)
    """
    limit = max(1, min(limit, 100))
    page  = max(1, page)
    offset = (page - 1) * limit

    filters: list[str] = []
    args:    list       = []

    def _add(col: str, val):
        args.append(val)
        filters.append(f"{col} = ${len(args)}")

    if materia:    _add("materia",    materia)
    if banca:      _add("banca",      banca)
    if tipo:       _add("tipo",       tipo)
    if dificuldade: _add("dificuldade", dificuldade)
    if bloco_id:   _add("bloco_origem_id", bloco_id)
    if search:
        args.append(f"%{search}%")
        filters.append(f"enunciado ILIKE ${len(args)}")

    where = f"WHERE {' AND '.join(filters)}" if filters else ""

    # Total count
    total: int = await db.fetchval(f"SELECT COUNT(*) FROM questoes {where}", *args)

    # Data page — add limit and offset as positional params
    args_data = list(args) + [limit, offset]
    limit_ph  = f"${len(args_data) - 1}"
    offset_ph = f"${len(args_data)}"

    rows = await db.fetch(
        f"SELECT * FROM questoes {where} ORDER BY criado_em DESC LIMIT {limit_ph} OFFSET {offset_ph}",
        *args_data,
    )

    return PaginatedQuestoes(
        total=total,
        page=page,
        limit=limit,
        data=[dict(r) for r in rows],
    )


# ─────────────────────────────────────────────────────────────────────────────
# POST /  — create questao manually
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/", response_model=QuestaoComItens, status_code=status.HTTP_201_CREATED)
async def create_questao(body: QuestaoUpdate):
    """
    Manually create a new question without AI parsing.
    Requires a full Questao payload.
    """
    # Convert QuestaoUpdate to QuestaoCreate mapping
    q = QuestaoCreate(
        banca=body.banca,
        ano=body.ano,
        cargo=body.cargo,
        materia=body.materia or "Geral",
        tipo=body.tipo or "multipla_escolha",
        enunciado=body.enunciado or "",
        alternativa_a=body.alternativa_a,
        alternativa_b=body.alternativa_b,
        alternativa_c=body.alternativa_c,
        alternativa_d=body.alternativa_d,
        alternativa_e=body.alternativa_e,
        gabarito=body.gabarito or "",
        comentario=body.comentario,
        dificuldade=body.dificuldade or "media",
        bloco_origem_id=body.bloco_origem_id,
    )
    
    new_id = await _insert_questao(q)
    
    # Insert questao_itens if combinacao_itens
    if q.tipo == "combinacao_itens" and body.itens:
        await db.executemany(
            """
            INSERT INTO questao_itens (questao_id, numero, enunciado, correto, ordem)
            VALUES ($1, $2, $3, $4, $5)
            """,
            [
                (new_id, item.numero, item.enunciado, item.correto, idx)
                for idx, item in enumerate(body.itens)
            ],
        )

    return await _fetch_with_itens(str(new_id))



# ─────────────────────────────────────────────────────────────────────────────
# GET /{id}  — single questao
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{questao_id}", response_model=QuestaoComItens)
async def get_questao(questao_id: str):
    """Fetch a single question with its itens (if combinacao_itens)."""
    return await _fetch_with_itens(questao_id)


# ─────────────────────────────────────────────────────────────────────────────
# PATCH /{id}  — partial update
# ─────────────────────────────────────────────────────────────────────────────

@router.patch("/{questao_id}", response_model=QuestaoComItens)
async def patch_questao(questao_id: str, body: QuestaoUpdate):
    """
    Partial update of a questao. Only provided (non-None) fields are written.
    Returns the updated questao with its itens.
    """
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=422, detail="Nenhum campo enviado para atualização.")

    itens_update = updates.pop("itens", None)

    if updates:
        # Build SET clause dynamically
        set_parts: list[str] = []
        values:    list      = []
        for col, val in updates.items():
            values.append(val)
            set_parts.append(f"{col} = ${len(values)}")

        values.append(questao_id)
        id_ph = f"${len(values)}"

        updated = await db.fetchrow(
            f"UPDATE questoes SET {', '.join(set_parts)} WHERE id = {id_ph} RETURNING *",
            *values,
        )
        if not updated:
            raise HTTPException(status_code=404, detail="Questão não encontrada.")
    elif itens_update is not None:
        # Ensure questao exists before modifying items
        exists = await db.fetchval("SELECT id FROM questoes WHERE id = $1", questao_id)
        if not exists:
            raise HTTPException(status_code=404, detail="Questão não encontrada.")

    if itens_update is not None:
        await db.execute("DELETE FROM questao_itens WHERE questao_id = $1", questao_id)
        if itens_update:
            await db.executemany(
                """
                INSERT INTO questao_itens (questao_id, numero, enunciado, correto, ordem)
                VALUES ($1, $2, $3, $4, $5)
                """,
                [
                    (questao_id, item["numero"], item["enunciado"], item.get("correto"), idx)
                    for idx, item in enumerate(itens_update)
                ],
            )

    return await _fetch_with_itens(questao_id)


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /{id}  — delete a questao
# ─────────────────────────────────────────────────────────────────────────────

@router.delete("/{questao_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_questao(questao_id: str):
    """Delete a question."""
    res = await db.execute("DELETE FROM questoes WHERE id = $1", questao_id)
    if res == "DELETE 0":
        raise HTTPException(status_code=404, detail="Questão não encontrada.")
    return None

# ─────────────────────────────────────────────────────────────────────────────
# POST /generate  — generate a question via Gemini AI  (bug fix: RETURNING id)
# ─────────────────────────────────────────────────────────────────────────────

# JSON Schema for Gemini structured output — covers all three question types
_GENERATE_SCHEMA = {
    "type": "object",
    "properties": {
        "enunciado":     {"type": "string"},
        "alternativa_a": {"type": "string"},
        "alternativa_b": {"type": "string"},
        "alternativa_c": {"type": "string"},
        "alternativa_d": {"type": "string"},
        "alternativa_e": {"type": "string"},
        "gabarito":      {"type": "string"},
        "comentario":    {"type": "string"},
    },
    "required": ["enunciado", "gabarito", "comentario"],
}

# Schema for combinacao_itens — itens array required
_GENERATE_SCHEMA_COMBINACAO = {
    "type": "object",
    "properties": {
        "enunciado":  {"type": "string"},
        "gabarito":   {"type": "string", "description": "Ex.: 'I-C, II-E, III-C'"},
        "comentario": {"type": "string"},
        "itens": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "numero":   {"type": "string"},
                    "enunciado": {"type": "string"},
                    "correto":  {"type": "boolean"},
                },
                "required": ["numero", "enunciado", "correto"],
            },
        },
    },
    "required": ["enunciado", "gabarito", "comentario", "itens"],
}


class GenerateRequest(BaseModel):
    bloco_id: str = Field(..., description="The ID of the bloco to generate a question from.")
    tipo: str = Field("multipla_escolha", description="Tipo de questão desejada")
    dificuldade: str = Field("media", description="Dificuldade desejada")


@router.post("/generate", response_model=QuestaoComItens, summary="Generate a question via AI")
async def generate_questao(body: GenerateRequest):
    """
    Reads a bloco's content, asks Gemini to generate a question via Structured Output,
    and saves it to the database.
    """
    from google import genai
    from google.genai import types

    # 1. Fetch bloco content
    row = await db.fetchrow(
        "SELECT conteudo, documento_id, identificador FROM blocos WHERE id = $1",
        body.bloco_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Bloco not found")

    bloco_conteudo = row["conteudo"]
    is_combinacao = body.tipo == "combinacao_itens"

    # 2. Build type-specific instructions
    if body.tipo == "multipla_escolha":
        type_instruction = (
            "Crie uma questão de MÚLTIPLA ESCOLHA com 5 alternativas (a, b, c, d, e). "
            "O campo 'gabarito' deve conter apenas a letra correta (ex.: 'A'). "
            "Preencha os campos alternativa_a até alternativa_e."
        )
    elif body.tipo == "certo_errado":
        type_instruction = (
            "Crie uma questão de CERTO ou ERRADO (afirmação única). "
            "O campo 'gabarito' deve ser 'Certo' ou 'Errado'. "
            "Não preencha campos de alternativas."
        )
    else:  # combinacao_itens
        type_instruction = (
            "Crie uma questão de COMBINAÇÃO DE ITENS com 3 a 5 afirmações no array 'itens'. "
            "Cada item deve ter 'numero' (ex.: 'I', 'II'), 'enunciado' e 'correto' (boolean). "
            "O campo 'gabarito' deve resumir o resultado (ex.: 'I-Certo, II-Errado, III-Certo'). "
            "Não preencha campos de alternativas a–e."
        )

    system_instruction = (
        "Você é um especialista em elaboração de questões de concurso público. "
        f"Baseado no texto fornecido, {type_instruction} "
        "Retorne APENAS um objeto JSON válido (sem marcação Markdown ou crases) "
        "com os campos exatos conforme o schema. "
        "O 'comentario' deve explicar o gabarito de forma didática."
    )

    prompt = (
        f"Gere uma questão de dificuldade '{body.dificuldade}' baseada no seguinte texto:\n\n"
        f"{bloco_conteudo}"
    )

    schema = _GENERATE_SCHEMA_COMBINACAO if is_combinacao else _GENERATE_SCHEMA

    try:
        client = ai_service._get_client()
        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=0.2,
            response_mime_type="application/json",
            response_schema=schema,
        )
        response = await client.aio.models.generate_content(
            model=ai_service.DEFAULT_MODEL,
            contents=[types.Content(role="user", parts=[types.Part(text=prompt)])],
            config=config,
        )
        generated_data = json.loads(response.text)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao gerar questão com IA: {exc}")

    # 3. Insert into DB — BUG FIX: use fetchval with RETURNING id
    try:
        q = QuestaoCreate(
            materia="Geral",
            tipo=body.tipo,
            enunciado=generated_data.get("enunciado", ""),
            alternativa_a=generated_data.get("alternativa_a"),
            alternativa_b=generated_data.get("alternativa_b"),
            alternativa_c=generated_data.get("alternativa_c"),
            alternativa_d=generated_data.get("alternativa_d"),
            alternativa_e=generated_data.get("alternativa_e"),
            gabarito=generated_data.get("gabarito", "A"),
            comentario=generated_data.get("comentario"),
            dificuldade=body.dificuldade,  # type: ignore[arg-type]
            bloco_origem_id=body.bloco_id,
        )
        new_id = await _insert_questao(q)

        # Insert questao_itens for combinacao_itens
        if is_combinacao and generated_data.get("itens"):
            await db.executemany(
                """
                INSERT INTO questao_itens (questao_id, numero, enunciado, correto, ordem)
                VALUES ($1, $2, $3, $4, $5)
                """,
                [
                    (new_id, item["numero"], item["enunciado"], item["correto"], idx)
                    for idx, item in enumerate(generated_data["itens"])
                ],
            )

        return await _fetch_with_itens(new_id)

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
# POST /generate-from-document  — batch AI generation from an entire document
#   context = all blocos + their annotations, enriched prompt to Gemini
# ─────────────────────────────────────────────────────────────────────────────

class GenerateFromDocumentRequest(BaseModel):
    documento_id: str = Field(..., description="ID of the document to generate questions from.")
    quantidade:   int = Field(5, ge=1, le=20, description="Number of questions to generate.")
    dificuldade:  str = Field("media", description="Target difficulty level.")


class GeneratedQuestionsResult(BaseModel):
    criadas:  int
    questoes: list[QuestaoComItens]


# Gemini structured output schema — one call returns N questions
_GENERATE_BATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "questoes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tipo": {
                        "type": "string",
                        "enum": ["multipla_escolha", "certo_errado", "combinacao_itens"],
                    },
                    "enunciado":     {"type": "string"},
                    "alternativa_a": {"type": "string"},
                    "alternativa_b": {"type": "string"},
                    "alternativa_c": {"type": "string"},
                    "alternativa_d": {"type": "string"},
                    "alternativa_e": {"type": "string"},
                    "gabarito":      {"type": "string"},
                    "comentario":    {"type": "string"},
                    "bloco_ref_index": {
                        "type": "integer",
                        "description": "0-based index into the context blocks array that this question was derived from.",
                    },
                    "itens": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "numero":    {"type": "string"},
                                "enunciado": {"type": "string"},
                                "correto":   {"type": "boolean"},
                            },
                            "required": ["numero", "enunciado", "correto"],
                        },
                    },
                },
                "required": ["tipo", "enunciado", "gabarito", "comentario", "bloco_ref_index"],
            },
        }
    },
    "required": ["questoes"],
}

_GENERATE_BATCH_SYSTEM = """
Você é um especialista em elaboração de questões de concurso público.
Receberá um conjunto de BLOCOS DE TEXTO e suas respectivas ANOTAÇÕES DO USUÁRIO.
Sua tarefa é gerar exatamente a quantidade de questões solicitada, cobrindo os conceitos
mais importantes do material, especialmente os pontos destacados nas anotações.

Regras obrigatórias:
- Varie os tipos: use multipla_escolha, certo_errado e combinacao_itens conforme adequado.
- Para multipla_escolha: preencha alternativa_a até alternativa_e; gabarito = letra maiúscula (ex.: "B").
- IMPORTANTE: Se criar uma questão com um Texto Base + múltiplos itens para julgar (estilo CESPE), você DEVE usar OBRIGATORIAMENTE o tipo "combinacao_itens". Coloque o Texto Base no campo "enunciado", e preencha a lista "itens". NUNCA crie o texto base como uma questão "certo_errado" separada dos seus itens.
- Para certo_errado isolado (um único item com seu próprio contexto): gabarito = "Certo" ou "Errado"; não preencha alternativas.
- O campo "comentario" deve explicar o gabarito didaticamente, citando o trecho do material.
- O campo "bloco_ref_index" deve apontar o índice (0-based) do bloco que originou a questão.
- Retorne APENAS o JSON. Sem markdown, sem explicações extras.
""".strip()


@router.post(
    "/generate-from-document",
    response_model=GeneratedQuestionsResult,
    status_code=status.HTTP_201_CREATED,
    summary="Batch-generate quiz questions from an entire document (blocos + annotations)",
)
async def generate_from_document(body: GenerateFromDocumentRequest):
    """
    1. Fetches all blocos for the document.
    2. Fetches all annotations (anotacoes) linked to those blocos.
    3. Builds an enriched context and calls Gemini Structured Output for N questions.
    4. Saves every generated question to the DB with bloco_origem_id.
    5. Returns the list of QuestaoComItens ready for an instant quiz session.
    """
    from google import genai
    from google.genai import types

    # ── 1. Collect blocos ────────────────────────────────────────────────────
    bloco_rows = await db.fetch(
        "SELECT id, conteudo, identificador FROM blocos WHERE documento_id = $1 ORDER BY ordem",
        body.documento_id,
    )
    if not bloco_rows:
        raise HTTPException(status_code=404, detail="Documento não encontrado ou sem blocos.")

    bloco_ids = [r["id"] for r in bloco_rows]

    # ── 2. Collect annotations for those blocos ──────────────────────────────
    anotacoes_rows = await db.fetch(
        "SELECT bloco_id, conteudo FROM anotacoes WHERE bloco_id = ANY($1::uuid[]) ORDER BY bloco_id",
        bloco_ids,
    )
    # Group annotations by bloco_id
    anotacoes_map: dict[int, list[str]] = {}
    for a in anotacoes_rows:
        anotacoes_map.setdefault(a["bloco_id"], []).append(a["conteudo"] or "")

    # ── 3. Build enriched context (truncated to stay within token budget) ────
    MAX_CHARS_PER_BLOCO = 800
    MAX_CHARS_ANOTACAO  = 600
    MAX_TOTAL_CHARS     = 28_000  # ~7 k tokens, safe for Gemini Flash

    context_blocks: list[dict] = []  # keeps {id, index} for bloco_ref mapping
    context_lines: list[str]   = []
    total_chars = 0

    for idx, bloco in enumerate(bloco_rows):
        bloco_text = (bloco["conteudo"] or "").strip()[:MAX_CHARS_PER_BLOCO]
        anotacoes  = anotacoes_map.get(bloco["id"], [])
        anotacao_text = ("\n".join(a.strip() for a in anotacoes))[:MAX_CHARS_ANOTACAO]

        entry = f"[BLOCO {idx}]\n{bloco_text}"
        if bloco["identificador"]:
            entry = f"[BLOCO {idx} | {bloco['identificador']}]\n{bloco_text}"
        if anotacao_text:
            entry += f"\n[ANOTAÇÕES DO USUÁRIO]\n{anotacao_text}"

        if total_chars + len(entry) > MAX_TOTAL_CHARS:
            break   # stop adding blocos if we'd exceed the budget

        context_lines.append(entry)
        context_blocks.append({"id": bloco["id"], "index": idx})
        total_chars += len(entry)

    full_context = "\n\n---\n\n".join(context_lines)

    prompt = (
        f"Gere exatamente {body.quantidade} questões de dificuldade '{body.dificuldade}' "
        f"baseadas no seguinte material de estudo:\n\n{full_context}"
    )

    # ── 4. Call Gemini ───────────────────────────────────────────────────────
    try:
        client = ai_service._get_client()
        config = types.GenerateContentConfig(
            system_instruction=_GENERATE_BATCH_SYSTEM,
            temperature=0.25,
            response_mime_type="application/json",
            response_schema=_GENERATE_BATCH_SCHEMA,
        )
        response = await client.aio.models.generate_content(
            model=ai_service.DEFAULT_MODEL,
            contents=[types.Content(role="user", parts=[types.Part(text=prompt)])],
            config=config,
        )
        parsed = json.loads(response.text)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha na geração com IA: {exc}")

    raw_questoes = parsed.get("questoes", [])
    if not raw_questoes:
        raise HTTPException(status_code=422, detail="A IA não gerou nenhuma questão.")

    # ── 5. Build response objects without saving to DB ───────────────────────
    questoes_criadas: list[QuestaoComItens] = []
    
    # We assign negative IDs so the frontend knows they are not in the DB
    temp_id_counter = -1

    for q_data in raw_questoes:
        ref_index = q_data.get("bloco_ref_index", 0)
        # Clamp to valid range
        ref_index = max(0, min(ref_index, len(context_blocks) - 1))
        bloco_id  = context_blocks[ref_index]["id"]

        tipo = q_data.get("tipo", "certo_errado")

        try:
            # Build the mock QuestaoComItens
            q_itens = []
            if tipo == "combinacao_itens" and q_data.get("itens"):
                for i, item in enumerate(q_data["itens"]):
                    q_itens.append(QuestaoItem(
                        id=str(temp_id_counter * 100 - i), # temporary negative id for item
                        questao_id=str(temp_id_counter),
                        numero=item["numero"],
                        enunciado=item["enunciado"],
                        correto=item.get("correto", True),
                        ordem=i
                    ))
            
            q_obj = QuestaoComItens(
                id=str(temp_id_counter),
                banca=q_data.get("banca"),
                ano=q_data.get("ano"),
                cargo=q_data.get("cargo"),
                materia="Geral",
                tipo=tipo,
                enunciado=q_data.get("enunciado", ""),
                alternativa_a=q_data.get("alternativa_a") or None,
                alternativa_b=q_data.get("alternativa_b") or None,
                alternativa_c=q_data.get("alternativa_c") or None,
                alternativa_d=q_data.get("alternativa_d") or None,
                alternativa_e=q_data.get("alternativa_e") or None,
                gabarito=q_data.get("gabarito", ""),
                comentario=q_data.get("comentario"),
                dificuldade=body.dificuldade,   # type: ignore[arg-type]
                bloco_origem_id=str(bloco_id),
                itens=q_itens
            )
            
            questoes_criadas.append(q_obj)
            temp_id_counter -= 1

        except Exception as exc:
            logger.error("Erro ao processar questão gerada: %s — %s", q_data, exc)
            continue  # best-effort: skip bad items

    if not questoes_criadas:
        raise HTTPException(status_code=500, detail="A IA falhou em gerar questões válidas.")

    return GeneratedQuestionsResult(criadas=len(questoes_criadas), questoes=questoes_criadas)



# Strict JSON Schema that Gemini must follow — mirrors QuestaoCreate exactly
_INGEST_SCHEMA = {
    "type": "object",
    "properties": {
        "questoes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "banca":         {"type": "string"},
                    "ano":           {"type": "integer"},
                    "cargo":         {"type": "string"},
                    "materia":       {"type": "string"},
                    "tipo": {
                        "type": "string",
                        "enum": ["multipla_escolha", "certo_errado", "combinacao_itens"],
                    },
                    "enunciado":     {"type": "string"},
                    "alternativa_a": {"type": "string"},
                    "alternativa_b": {"type": "string"},
                    "alternativa_c": {"type": "string"},
                    "alternativa_d": {"type": "string"},
                    "alternativa_e": {"type": "string"},
                    "gabarito":      {"type": "string"},
                    "comentario":    {"type": "string"},
                    "dificuldade": {
                        "type": "string",
                        "enum": ["facil", "media", "dificil"],
                    },
                    "itens": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "numero":    {"type": "string"},
                                "enunciado": {"type": "string"},
                                "correto":   {"type": "boolean"},
                            },
                            "required": ["numero", "enunciado"],
                        },
                    },
                },
                "required": ["enunciado", "gabarito", "tipo"],
            },
        }
    },
    "required": ["questoes"],
}

_INGEST_SYSTEM_PROMPT = """
Você é um parser especialista em questões de concurso público.
Sua tarefa é extrair UMA OU MAIS questões do texto recebido e retornar um JSON estruturado.

Regras:
- Extraia TODAS as questões presentes no texto.
- Para questões de múltipla escolha, preencha alternativa_a até alternativa_e.
- IMPORTANTE: Se o texto contiver um Texto Base (ex: "Julgue os itens a seguir:") seguido de múltiplos itens de julgamento, você DEVE agrupá-los em UMA ÚNICA questão do tipo "combinacao_itens". O Texto Base vai no campo "enunciado", e os itens vão no array "itens" (com numero, enunciado e correto). NUNCA divida o texto base e os itens em questões de "certo_errado" independentes.
- Use "certo_errado" APENAS para questões isoladas que contenham seu próprio contexto e afirmação numa coisa só.
- O campo "gabarito" deve conter a resposta (letra para múltipla escolha, "Certo"/"Errado" para certo_errado, resumo para combinacao_itens).
- "dificuldade" padrão: "media". Infira se houver indicação no texto.
- "materia" padrão: "" (string vazia) se não identificado.
- Não invente informações que não estão no texto.
- Retorne APENAS o JSON. Sem markdown, sem explicações.
""".strip()


@router.post(
    "/ingest",
    response_model=IngestResult,
    status_code=status.HTTP_201_CREATED,
    summary="Parse and bulk-ingest questions via Gemini Structured Output",
)
async def ingest_questoes(body: IngestPayload):
    """
    Accepts a Markdown or JSON text containing one or more questions.
    Uses Gemini Structured Output to parse it into validated QuestaoCreate objects
    and inserts them into the database.
    """
    from google import genai
    from google.genai import types

    # 1. Call Gemini with strict JSON Schema
    try:
        client = ai_service._get_client()
        config = types.GenerateContentConfig(
            system_instruction=_INGEST_SYSTEM_PROMPT,
            temperature=0.0,  # deterministic parsing
            response_mime_type="application/json",
            response_schema=_INGEST_SCHEMA,
        )
        response = await client.aio.models.generate_content(
            model=ai_service.DEFAULT_MODEL,
            contents=[
                types.Content(
                    role="user",
                    parts=[types.Part(text=f"Texto para parsing:\n\n{body.texto}")],
                )
            ],
            config=config,
        )
        parsed = json.loads(response.text)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Falha ao parsear questões com Gemini: {exc}",
        )

    raw_questoes = parsed.get("questoes", [])
    if not raw_questoes:
        raise HTTPException(
            status_code=422,
            detail="Nenhuma questão identificada no texto enviado.",
        )

    # 2. Validate each item via Pydantic and insert
    criadas: list[Questao] = []

    for raw in raw_questoes:
        itens_raw = raw.pop("itens", [])  # separate before Pydantic validation

        try:
            q = QuestaoCreate(**raw)
        except Exception as exc:
            logger.warning("Questão inválida ignorada durante ingestão: %s — %s", raw, exc)
            continue  # skip invalid entries rather than aborting the whole batch

        try:
            new_id = await _insert_questao(q)

            # Insert questao_itens if combinacao_itens
            if q.tipo == "combinacao_itens" and itens_raw:
                await db.executemany(
                    """
                    INSERT INTO questao_itens (questao_id, numero, enunciado, correto, ordem)
                    VALUES ($1, $2, $3, $4, $5)
                    """,
                    [
                        (
                            new_id,
                            item.get("numero", str(idx + 1)),
                            item.get("enunciado", ""),
                            item.get("correto", None),
                            idx,
                        )
                        for idx, item in enumerate(itens_raw)
                    ],
                )

            row = await db.fetchrow("SELECT * FROM questoes WHERE id = $1", new_id)
            criadas.append(Questao(**dict(row)))

        except Exception as exc:
            logger.error("Erro ao inserir questão no banco: %s", exc)
            # continue with remaining questions

    if not criadas:
        raise HTTPException(
            status_code=500,
            detail="Nenhuma questão foi inserida. Verifique os campos obrigatórios.",
        )

    return IngestResult(criadas=len(criadas), questoes=criadas)
