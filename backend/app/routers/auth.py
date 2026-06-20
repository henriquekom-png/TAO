from fastapi import APIRouter
from pydantic import BaseModel
import os
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

class LoginRequest(BaseModel):
    password: str

@router.post("/verify")
async def verify_password(req: LoginRequest):
    expected_password = os.getenv("APP_GATE_PASSWORD")
    
    # Se a senha não estiver configurada no .env, deixamos passar (aberto)
    if not expected_password:
        return {"valid": True}
    
    if req.password == expected_password:
        return {"valid": True}
        
    return {"valid": False}
