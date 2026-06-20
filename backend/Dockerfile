FROM python:3.11-slim

# Impede o Python de gerar arquivos .pyc e força o log a aparecer no console
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Copia os arquivos de requisitos e instala
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia todo o código do backend
COPY . .

# Expõe a porta que o Cloud Run usa por padrão
EXPOSE 8080

# Comando para iniciar o servidor
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
