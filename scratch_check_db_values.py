import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()
db_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")

async def main():
    conn = await asyncpg.connect(db_url, statement_cache_size=0)
    print("--- PASTAS ---")
    pastas = await conn.fetch("SELECT * FROM pastas ORDER BY nivel, ordem")
    for p in pastas:
        print(dict(p))
    print("--- DOCUMENTOS ---")
    docs = await conn.fetch("SELECT * FROM documentos ORDER BY pasta_id, ordem")
    for d in docs:
        print(dict(d))
    await conn.close()

asyncio.run(main())
