import asyncio
from app.database import db

async def fix_schema():
    await db.connect()
    try:
        await db.execute('ALTER TABLE questoes ALTER COLUMN id SET DEFAULT gen_random_uuid();')
        await db.execute('ALTER TABLE questao_itens ALTER COLUMN id SET DEFAULT gen_random_uuid();')
        await db.execute('ALTER TABLE quiz_resultados ALTER COLUMN id SET DEFAULT gen_random_uuid();')
        print("Schema fixed!")
    except Exception as e:
        print(e)
    await db.disconnect()

asyncio.run(fix_schema())
