import urllib.request
import json
import re

pastas_url = 'http://127.0.0.1:8000/api/v1/pastas'
try:
    req = urllib.request.Request(pastas_url)
    with urllib.request.urlopen(req) as response:
        pastas = json.loads(response.read().decode())
        
        for pasta in pastas:
            if 'Constitui' in pasta.get('nome', '') or 'CLT' in pasta.get('nome', '') or 'Garantias' in pasta.get('nome', ''):
                print(f"PASTA: {pasta['nome']}")
                docs_url = f"http://127.0.0.1:8000/api/v1/documentos/pasta/{pasta['id']}"
                req2 = urllib.request.Request(docs_url)
                with urllib.request.urlopen(req2) as r2:
                    docs = json.loads(r2.read().decode())
                    for doc in docs:
                        print(f"  DOC: {doc['titulo']}")
                        doc_url = f"http://127.0.0.1:8000/api/v1/documentos/{doc['id']}"
                        req3 = urllib.request.Request(doc_url)
                        with urllib.request.urlopen(req3) as r3:
                            full_doc = json.loads(r3.read().decode())
                            for b in full_doc.get('blocos', [])[:5]:
                                print("    BLOCO:", repr(b.get('conteudo', '')))
except Exception as e:
    print('Error:', e)
