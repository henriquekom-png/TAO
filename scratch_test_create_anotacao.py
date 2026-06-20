"""
Script para diagnosticar o erro 500 no POST /anotacoes/
"""
import asyncio
import os
import sys

# Force UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from dotenv import load_dotenv
load_dotenv()

import asyncpg

async def main():
    db_url = os.getenv("SUPABASE_DB_URL")
    if not db_url:
        print("ERRO: SUPABASE_DB_URL nao configurado no .env")
        return

    print("Conectando ao banco...")
    
    try:
        conn = await asyncpg.connect(dsn=db_url, timeout=15)
        print("OK: Conectado!")
    except Exception as e:
        print(f"ERRO ao conectar: {e}")
        return

    # 1. Verificar estrutura real da tabela anotacoes
    print("\n--- Estrutura da tabela anotacoes ---")
    try:
        cols = await conn.fetch("""
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'anotacoes'
            ORDER BY ordinal_position
        """)
        for col in cols:
            print(f"  {col['column_name']:20} {col['data_type']:20} nullable={col['is_nullable']} default={col['column_default']}")
    except Exception as e:
        print(f"ERRO ao verificar estrutura: {e}")

    # 2. Verificar estrutura real da tabela blocos (tipo do id)
    print("\n--- Tipo do campo id em blocos ---")
    try:
        cols = await conn.fetch("""
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'blocos' AND column_name = 'id'
        """)
        for col in cols:
            print(f"  blocos.id tipo: {col['data_type']}")
    except Exception as e:
        print(f"ERRO: {e}")

    # 3. Pega o primeiro bloco existente
    print("\n--- Buscando um bloco existente ---")
    try:
        bloco = await conn.fetchrow("SELECT id, conteudo FROM blocos LIMIT 1")
        if not bloco:
            print("NENHUM bloco encontrado no banco!")
            await conn.close()
            return
        bloco_id = bloco['id']
        print(f"OK: bloco id={bloco_id!r} (tipo: {type(bloco_id).__name__})")
    except Exception as e:
        print(f"ERRO buscando bloco: {e}")
        await conn.close()
        return

    # 4. Testa INSERT com str(bloco_id)
    print(f"\n--- Tentando INSERT com str(bloco_id)='{bloco_id}' ---")
    try:
        row = await conn.fetchrow(
            """
            INSERT INTO anotacoes (bloco_id, tipo, conteudo, ordem)
            VALUES ($1, $2, $3, $4)
            RETURNING id, bloco_id, tipo, conteudo, ordem
            """,
            str(bloco_id), 'portal', '((test-uuid))', 0
        )
        print(f"OK: Anotacao criada: {dict(row)}")
        await conn.execute("DELETE FROM anotacoes WHERE id = $1", row['id'])
        print("OK: Registro de teste removido.")
    except Exception as e:
        print(f"ERRO no INSERT: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()

    await conn.close()
    print("\nDone.")

asyncio.run(main())
