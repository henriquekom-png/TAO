# run_backend.ps1
# Script para iniciar o backend do TAO usando o ambiente virtual correto

Write-Host "Iniciando o servidor FastAPI..." -ForegroundColor Cyan

# 1. Entra na pasta backend
Set-Location -Path "backend"

# 2. Verifica e ativa o ambiente virtual
if (Test-Path ".venv\Scripts\Activate.ps1") {
    . ".venv\Scripts\Activate.ps1"
    Write-Host "Ambiente virtual (.venv) ativado com sucesso!" -ForegroundColor Green
} else {
    Write-Host "AVISO: O ambiente virtual '.venv' não foi encontrado dentro da pasta 'backend'." -ForegroundColor Yellow
    Write-Host "O uvicorn tentará rodar com o Python global, o que pode causar erros de importação." -ForegroundColor Yellow
}

# 3. Roda o Uvicorn
Write-Host "Executando: uvicorn app.main:app --reload --port 8000" -ForegroundColor Cyan
uvicorn app.main:app --reload --port 8000
