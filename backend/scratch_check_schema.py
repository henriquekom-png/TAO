import asyncio
from app.database import db

async def check_schema():
    await db.connect()
    rows = await db.fetch("""
        SELECT column_name, data_type, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_name IN ('questoes', 'questao_itens', 'quiz_resultados');
    """)
    for row in rows:
        print(row)
    await db.disconnect()

asyncio.run(check_schema())
