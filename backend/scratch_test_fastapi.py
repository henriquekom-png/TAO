import asyncio
from fastapi.testclient import TestClient
from app.main import app

with TestClient(app) as client:
    try:
        response = client.get("/api/v1/questoes/?page=1&limit=20")
        print(response.status_code)
        print(response.text)
    except Exception as e:
        import traceback
        traceback.print_exc()
