"""
TAO Backend – Conexão Exclusiva PostgreSQL (Supabase)
=============================================
Gerencia conexões com PostgreSQL. O modo local (SQLite) foi descontinuado
para simplificação arquitetural em favor da estratégia PWA.
"""

import os
import logging
from typing import Any, List, Optional
import asyncpg
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

class DatabaseManager:
    """Gerenciador de Conexões PostgreSQL (Supabase)."""

    def __init__(self):
        self._pg_pool: Optional[asyncpg.Pool] = None
        self.pg_url = os.getenv("SUPABASE_DB_URL")
        
    async def connect(self):
        """Inicializa pool de conexões no startup da aplicação."""
        if not self.pg_url:
            logger.error("SUPABASE_DB_URL não configurado. O backend precisa do Supabase para funcionar.")
            raise ValueError("SUPABASE_DB_URL missing")
            
        async def init(con):
            # Registra o encoder/decoder para o tipo UUID nativo do Postgres
            await con.set_type_codec(
                'uuid',
                schema='pg_catalog',
                format='text',
                encoder=lambda u: str(u) if u is not None else None,
                decoder=lambda u: str(u) if u is not None else None
            )

        self._pg_pool = await asyncpg.create_pool(
            dsn=self.pg_url,
            min_size=2,
            max_size=10,
            command_timeout=30,
            init=init,
            statement_cache_size=0
        )
        logger.info("Asyncpg connection pool ready (Supabase).")

    async def disconnect(self):
        """Encerra conexões no shutdown."""
        if self._pg_pool:
            await self._pg_pool.close()
            logger.info("Asyncpg connection pool closed.")

    @property
    def is_cloud(self) -> bool:
        """Mantido temporariamente para compatibilidade legada, mas sempre retorna True."""
        return True

    def _format_row(self, row) -> Optional[dict]:
        """Formata os rows retornados para um padrão dict."""
        if not row:
            return None
        return dict(row)

    # ==========================================
    # Funções CRUD (Fetch, Execute)
    # ==========================================
    async def fetch(self, query: str, *args) -> List[dict]:
        async with self._pg_pool.acquire() as conn:
            rows = await conn.fetch(query, *args)
            return [dict(r) for r in rows]

    async def fetchrow(self, query: str, *args) -> Optional[dict]:
        async with self._pg_pool.acquire() as conn:
            row = await conn.fetchrow(query, *args)
            return self._format_row(row)

    async def fetchval(self, query: str, *args) -> Any:
        async with self._pg_pool.acquire() as conn:
            return await conn.fetchval(query, *args)

    async def execute(self, query: str, *args) -> None:
        async with self._pg_pool.acquire() as conn:
            await conn.execute(query, *args)
            
    async def executemany(self, query: str, args: List[tuple]) -> None:
        async with self._pg_pool.acquire() as conn:
            await conn.executemany(query, args)

    # ==========================================
    # Motor de RAG (TSVECTOR)
    # ==========================================
    async def search_blocos_fts(self, search_term: str, limit: int = 10) -> List[dict]:
        """Busca textual avançada no Postgres."""
        query = """
            SELECT id, conteudo, identificador, documento_id
            FROM blocos
            WHERE deleted_at IS NULL
              AND fts_vector @@ plainto_tsquery('portuguese', $1)
            LIMIT $2
        """
        return await self.fetch(query, search_term, limit)

# Singleton global instanciado
db = DatabaseManager()
