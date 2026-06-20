import asyncio
import sys
import os

# Add backend directory to path
sys.path.append(os.path.abspath('backend'))

from app.database import db

async def check():
    await db.connect()
    rows = await db.fetch('SELECT id, conteudo FROM blocos LIMIT 10')
    for row in rows:
        print(f"ID: {row['id']} | Content: {repr(row['conteudo'])}")
    await db.disconnect()

if __name__ == '__main__':
    asyncio.run(check())
