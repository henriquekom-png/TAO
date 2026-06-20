import urllib.request
import json
import socket

socket.setdefaulttimeout(5)
print("Testing root...")
try:
    with urllib.request.urlopen("http://localhost:8000/") as response:
        print("Root response:", response.status, response.read().decode()[:200])
except Exception as e:
    print("Root failed:", e)

print("Testing tree...")
try:
    with urllib.request.urlopen("http://localhost:8000/api/v1/pastas/tree") as response:
        print("Tree response:", response.status, response.read().decode()[:200])
except Exception as e:
    print("Tree failed:", e)
