import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()
db_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")
print("Connecting to:", db_url)

async def main():
    try:
        conn = await asyncpg.connect(db_url, timeout=10)
        print("Connected successfully!")
        val = await conn.fetchval("SELECT COUNT(*) FROM pastas")
        print("Pastas count:", val)
        await conn.close()
    except Exception as e:
        print("Error connecting to database:", e)

asyncio.run(main())
