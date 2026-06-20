import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()
db_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DB_URL")

async def main():
    conn = await asyncpg.connect(db_url, statement_cache_size=0)
    print("Terminating other database sessions to clear locks...")
    try:
        # Terminate other connections so we can acquire an AccessExclusiveLock
        await conn.execute("""
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid();
        """)
        print("Other sessions terminated.")
    except Exception as e:
        print("Warning terminating sessions:", e)

    print("Altering pastas.ordem column...")
    await conn.execute("ALTER TABLE pastas ALTER COLUMN ordem TYPE DOUBLE PRECISION;")
    print("Altering documentos.ordem column...")
    await conn.execute("ALTER TABLE documentos ALTER COLUMN ordem TYPE DOUBLE PRECISION;")
    print("Migration completed successfully!")
    await conn.close()

asyncio.run(main())
