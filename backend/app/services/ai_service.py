"""
services/ai_service.py
======================
Gemini RAG integration using the **new** google-genai SDK (v1.0+).

SDK docs: https://googleapis.github.io/python-genai/

Key differences from the legacy google-generativeai SDK
--------------------------------------------------------
- Import:    ``from google import genai``  (not ``import google.generativeai``)
- Client:    ``genai.Client(api_key=...)``
- Generate:  ``client.models.generate_content(model, contents, config)``
- Async:     ``await client.aio.models.generate_content(...)``
- History:   Passed as a ``list[types.Content]``, not start_chat()

Environment variable
--------------------
    GEMINI_API_KEY=<your key>   ← read from .env / environment
"""

from __future__ import annotations

import logging
import os
import ssl
from typing import Optional

from dotenv import load_dotenv

# Monkey-patch SSL para ignorar verificação no ambiente de desenvolvimento local
try:
    ssl.create_default_context = ssl._create_unverified_context
except AttributeError:
    pass

load_dotenv()

logger = logging.getLogger(__name__)

# ── Default model (can be overridden per-request) ─────────────────────────────
DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

# ── System prompt (ported verbatim from modules/chatbot.py) ──────────────────
SYSTEM_PROMPT = """
Você é o Assistente de Revisão TAO — especialista em Direito e focado em preparação para concursos públicos.

Sua PRIORIDADE ABSOLUTA na elaboração de respostas:
1. Responda em PRIMEIRO LUGAR baseando-se no contexto fornecido (blocos normativos e anotações do usuário).
   - Quando usar o contexto, indique claramente: "De acordo com seus materiais indexados..." ou "Segundo suas anotações...".
   - Dê peso altíssimo aos trechos marcados como anotações do utilizador (§ Notas), distinguindo-os do texto da lei.

2. SE a informação solicitada não estiver no contexto fornecido, utilize em SEGUNDO LUGAR o seu vasto conhecimento jurídico especializado sobre concursos públicos para responder ou complementar.
   - Quando usar seu conhecimento pré-treinado, você DEVE advertir explicitamente o usuário: "Não encontrei essa informação no material indexado. No entanto, com base no conhecimento jurídico geral/jurisprudencial para concursos..."

Outras Regras:
- Responda SEMPRE em português do Brasil.
- Ao citar dispositivos legais, mencione sempre o número e o artigo.
- Seja conciso, preciso, didático e utilize formatação rica em Markdown.
""".strip()

# ── Stop-words PT-BR used when building the LIKE fallback ─────────────────────
_STOP_WORDS = {
    "o","a","os","as","um","uma","de","do","da","dos","das","em","no",
    "na","nos","nas","para","por","com","que","se","e","ou","ao","à",
    "é","foi","ser","ter","tem","não","mais","já","como","isso","este",
    "esta","esse","essa","seu","sua","possui","qual","quais","quando",
}


# ── Lazy client singleton ─────────────────────────────────────────────────────

_client = None   # initialised on first use


def _get_client():
    """Return the google.genai async-capable Client, creating it once."""
    global _client
    if _client is not None:
        return _client

    from dotenv import load_dotenv, find_dotenv
    load_dotenv(find_dotenv(), override=True)

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY environment variable is not set. "
            "Add it to your .env file e reinicie o backend."
        )

    try:
        from google import genai
        # Disable SSL verification for local dev environment
        _client = genai.Client(api_key=api_key)
        logger.info("google.genai Client initialised (model: %s) with SSL verification disabled via monkey-patch", DEFAULT_MODEL)
        return _client
    except ImportError as exc:
        raise ImportError(
            "google-genai package is not installed. "
            "Run: pip install google-genai>=1.0.0"
        ) from exc


# ── Context helpers ───────────────────────────────────────────────────────────

def _build_context(sources: list[dict]) -> str:
    """Format RAG source chunks into a plain-text context block."""
    if not sources:
        return "(Nenhum conteúdo relevante encontrado no material indexado.)"
    parts = [f"[{s['fonte']}]\n{s['conteudo']}" for s in sources]
    return "\n\n---\n\n".join(parts)


def _build_prompt(context: str, question: str) -> str:
    return (
        f"Contexto do material de estudo:\n\n{context}\n\n"
        f"Pergunta: {question}\n\n"
        f"Responda com base no contexto acima."
    )


# ── Main async generate function ──────────────────────────────────────────────

async def generate_response(
    question: str,
    sources: list[dict],
    history: Optional[list[dict]] = None,
    model: str = DEFAULT_MODEL,
) -> str:
    """
    Call Gemini via the google.genai v1+ async API and return the text response.

    Parameters
    ----------
    question : str
        The user's question (already embedded in the prompt with context).
    sources : list[dict]
        RAG chunks returned by ``vector_service.search()``.
        Each dict has keys ``fonte`` and ``conteudo``.
    history : list[dict] | None
        Optional conversation history as ``[{"role": "user"|"model", "content": "..."}]``.
    model : str
        Gemini model ID (default: ``gemini-2.5-flash``).

    Returns
    -------
    str
        The model's text response (Markdown formatted).
    """
    from google import genai
    from google.genai import types

    client  = _get_client()
    context = _build_context(sources)
    prompt  = _build_prompt(context, question)

    # Build the contents list:
    # System instruction goes in GenerateContentConfig; history + current turn go in contents.
    contents: list[types.Content] = []

    if history:
        for msg in history:
            role = "user" if msg.get("role") == "user" else "model"
            contents.append(
                types.Content(
                    role=role,
                    parts=[types.Part(text=msg.get("content", ""))],
                )
            )

    # Current user turn
    contents.append(
        types.Content(
            role="user",
            parts=[types.Part(text=prompt)],
        )
    )

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        max_output_tokens=2048,
        temperature=0.3,          # lower temperature → more factual for legal content
    )

    try:
        response = await client.aio.models.generate_content(
            model=model,
            contents=contents,
            config=config,
        )
        return response.text or ""
    except Exception as exc:
        err = str(exc)
        logger.error("Gemini API error: %s", err)

        # Surface rate-limit errors in a user-friendly way
        if "429" in err or "RESOURCE_EXHAUSTED" in err:
            return (
                "⚠️ **Limite de requisições atingido.**\n\n"
                "Aguarde alguns momentos e tente novamente, "
                "ou troque para um modelo diferente.\n\n"
                f"Detalhe: `{err[:200]}`"
            )
        raise


async def list_models() -> list[str]:
    """Return available Gemini model IDs (useful for a /models debug endpoint)."""
    from google import genai  # noqa: F401
    client = _get_client()
    models = []
    async for m in client.aio.models.list():
        if "generateContent" in (m.supported_actions or []):
            models.append(m.name)
    return models
