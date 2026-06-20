"""
Router – /api/v1/database
========================

Endpoints for database management and backups.
"""

from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse

from app.database import db

router = APIRouter()

@router.post(
    "/backup",
    summary="Create a database backup",
    description="Extracts data from core tables and returns them as a JSON backup file.",
)
async def create_backup():
    """Dumps all core tables to a JSON object."""
    tables = [
        "pastas", "documentos", "blocos", "anotacoes", 
        "portais", "materiais", "questoes", "questao_itens", "quiz_resultados"
    ]
    
    backup_data = {}
    
    try:
        for table in tables:
            # Note: For large tables this could be memory intensive, but works for personal study app scale.
            rows = await db.fetch(f"SELECT * FROM {table}")
            
            # Convert asyncpg Records to dicts, handling datetime serialization
            table_data = []
            for row in rows:
                row_dict = dict(row)
                for key, value in row_dict.items():
                    if isinstance(value, datetime):
                        row_dict[key] = value.isoformat()
                    # other pg types like date could be added here if needed
                    elif hasattr(value, "isoformat"):
                        row_dict[key] = value.isoformat()
                table_data.append(row_dict)
                
            backup_data[table] = table_data
            
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Backup failed: {exc}",
        )
        
    return JSONResponse(
        content={
            "timestamp": datetime.now().isoformat(),
            "data": backup_data
        },
        headers={
            "Content-Disposition": f"attachment; filename=tao_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        }
    )
