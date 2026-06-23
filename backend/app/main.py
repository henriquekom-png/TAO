"""
backend/app/main.py
"""

import os
import certifi
os.environ['SSL_CERT_FILE'] = certifi.where()

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.database import db
from app.routers import (
    pastas, documentos, blocos, review, chat, database, 
    questoes, anotacoes, nodes, quiz, search, auth
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup → abre os pools (Supabase + SQLite); Shutdown → encerra os pools."""
    await db.connect()
    yield
    await db.disconnect()

app = FastAPI(
    title="TAO API Híbrida",
    version="0.3.0",
    description=(
        "FastAPI backend for the TAO study app (PostgreSQL Nuvem).\n\n"
        "Interactive docs: [Swagger UI](/docs) · [ReDoc](/redoc)"
    ),
    lifespan=lifespan,
)

# CORS configurado para PWA/Nuvem e Desenvolvimento Local
# Pega a lista de origens permitidas da variável de ambiente ou usa um padrão seguro
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173,http://localhost:3000,https://tao-app-500020.web.app")
allowed_origins = [origin.strip().rstrip("/") for origin in frontend_url.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



# ---------------------------------------------------------------------------
# Health-check
# ---------------------------------------------------------------------------
@app.get("/health", tags=["meta"])
async def health():
    ts = await db.fetchval("SELECT CURRENT_TIMESTAMP")
    return {
        "status": "ok", 
        "active_mode": "cloud",
        "timestamp": str(ts)
    }

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
_V1 = "/api/v1"

app.include_router(pastas.router,     prefix=f"{_V1}/pastas",     tags=["Pastas"])
app.include_router(documentos.router, prefix=f"{_V1}/documentos", tags=["Documentos"])
app.include_router(blocos.router,     prefix=f"{_V1}/blocos",     tags=["Blocos"])
app.include_router(review.router,     prefix=f"{_V1}/review",     tags=["Review / FSRS"])
app.include_router(chat.router,       prefix=f"{_V1}/chat",       tags=["Chat / RAG"])
app.include_router(database.router,   prefix=f"{_V1}/database",   tags=["Database"])
app.include_router(questoes.router,   prefix=f"{_V1}/questoes",   tags=["Questoes"])
app.include_router(quiz.router,       prefix=f"{_V1}/quiz",       tags=["Quiz / Simulado"])
app.include_router(anotacoes.router,  prefix=f"{_V1}/anotacoes",  tags=["Anotacoes"])
app.include_router(nodes.router,      prefix=f"{_V1}/nodes",      tags=["Nodes"])
app.include_router(search.router,     prefix=f"{_V1}/search",     tags=["Search"])
app.include_router(auth.router,       prefix=f"{_V1}/auth",       tags=["Auth"])
