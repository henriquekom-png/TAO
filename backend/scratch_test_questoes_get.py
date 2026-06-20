import httpx

r = httpx.get("http://localhost:8000/api/v1/questoes/?page=1&limit=20")
print("Status:", r.status_code)
print("Text:", r.text)
