import asyncio
from fastapi.testclient import TestClient
from app.main import app

with TestClient(app) as client:
    try:
        response = client.post("/api/v1/questoes/ingest", json={
            "texto": "Questão 1: O céu é azul? a) sim b) não. Gabarito: A.",
            "formato": "markdown"
        })
        print(response.status_code)
        print(response.text)
    except Exception as e:
        import traceback
        traceback.print_exc()
