#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
seed_questoes.py — Bulk insert de questões (PostgreSQL / Supabase) para o TAO.

Não altera app.py nem outros módulos da aplicação.

COMO CORRER
-----------
  1) Na raiz do projeto, crie um ficheiro .env (não versionado; ver .gitignore)
     com a linha:
       SUPABASE_DB_URL=postgresql://...
     Pode copiar .env.example como ponto de partida.
  2) pip install -r requirements.txt   # inclui python-dotenv
  3) python seed_questoes.py caminho/para/questoes.json

  O script carrega automaticamente .env na raiz. Também pode definir
  SUPABASE_DB_URL só no terminal, se preferir.

CREDENCIAIS (variáveis de ambiente — NUNCA commitar valores)
-------------------------------------------------------------
  Obrigatório (modo implementado — igual ao resto do projeto):
    SUPABASE_DB_URL
      URI PostgreSQL do Supabase (Transaction ou Session pooler).
      Ex.: postgresql://postgres.[ref]:[senha]@...supabase.com:5432/postgres
      Recomendado: ficheiro .env na raiz (mesmo valor que em .streamlit/secrets.toml).

  Alternativa mencionada no pedido (não usada neste script):
    supabase-py precisa de SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
    (chave *service_role* para contornar RLS em inserts via REST).
    Inserts via anon key falham se RLS bloquear escrita em `questoes`.

SCHEMA (ver supabase_schema.sql no repositório)
------------------------------------------------
  questoes: banca, ano, cargo, materia, tipo (CHECK), enunciado,
            alternativa_a..e, gabarito, comentario, dificuldade, ...
  questao_itens: questao_id FK, numero, enunciado, correto, ordem

CONTRATO JSON
-------------
  Array na raiz [ {...}, ... ]. Se vier [[ ... ]], o script usa o array interior.
  Campos com acentos: matéria, tipo de questão, gabarito comentado, afirmações, alternativas.

  Formato alternativo (exportação TAO / outras fontes):
    opcoes          — mesmo papel que alternativas { "a": "...", "b": "..." }
    alternativa_correta — letra "a".."e" (se ausente "gabarito")
    comentarios     — mesmo papel que "gabarito comentado"
    materia         — sem acento, além de matéria
    itens           — lista de strings "Item I - texto...", "Item II - ..." (V/F por item)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

# Carrega .env na raiz do projeto (python-dotenv em requirements.txt)
try:
    from dotenv import load_dotenv

    _root = Path(__file__).resolve().parent
    load_dotenv(_root / ".env")
except ImportError:
    pass  # defina SUPABASE_DB_URL no ambiente ou: pip install python-dotenv

ROMAN_KEYS = ("I", "II", "III", "IV", "V")


def _ensure_db_url() -> str:
    url = (os.environ.get("SUPABASE_DB_URL") or "").strip()
    if not url:
        print(
            "Erro: defina SUPABASE_DB_URL no ambiente ou em .env",
            file=sys.stderr,
        )
        sys.exit(1)
    if "sslmode=" not in url:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}sslmode=require"
    return url


def normalize_questoes_list(data: Any) -> list[dict[str, Any]]:
    """Aceita [ {...} ] ou [[ {...}, ... ]]."""
    if not isinstance(data, list):
        raise ValueError("JSON na raiz deve ser um array.")
    if len(data) == 1 and isinstance(data[0], list):
        inner = data[0]
        if not isinstance(inner, list):
            raise ValueError("Array interior inválido.")
        return inner
    return data


def extract_ano(concurso: str | None) -> int | None:
    if not concurso:
        return None
    s = str(concurso)
    m = re.search(r"MPT/(\d{4})", s, re.I)
    if m:
        return int(m.group(1))
    m = re.search(r"\b(19\d{2}|20\d{2})\b", s)
    if m:
        return int(m.group(1))
    return None


def nullable_text(v: Any) -> str | None:
    if v is None:
        return None
    t = str(v).strip()
    return t if t else None


def _norm_gabarito_letra(s: str | None) -> str:
    """Extrai letra A–E (ex.: 'b', 'Letra B', '(C)')."""
    if not s:
        return ""
    t = s.strip().upper()
    if len(t) == 1 and t in "ABCDE":
        return t
    for c in t:
        if c in "ABCDE":
            return c
    return ""


_ITEM_ROMAN_RE = re.compile(
    r"^\s*Item\s+(I{1,3}|IV|V)\s*[-–—]\s*(.+)\s*$",
    re.IGNORECASE | re.DOTALL,
)


def map_questao_row(raw: dict[str, Any], *, tipo: str) -> dict[str, Any]:
    """Mapeia um objeto JSON para colunas de `questoes` (sem id)."""
    materia = (
        nullable_text(raw.get("matéria"))
        or nullable_text(raw.get("materia"))
        or ""
    )
    concurso = nullable_text(raw.get("concurso"))
    enunciado = nullable_text(raw.get("enunciado")) or ""
    if not enunciado:
        raise ValueError("Questão sem enunciado.")

    alts = raw.get("alternativas") or raw.get("opcoes") or {}
    if not isinstance(alts, dict):
        alts = {}

    gabarito = _norm_gabarito_letra(nullable_text(raw.get("gabarito")))
    if not gabarito:
        gabarito = _norm_gabarito_letra(nullable_text(raw.get("alternativa_correta")))
    if not gabarito:
        raise ValueError(
            "Questão sem gabarito válido (use gabarito ou alternativa_correta: A–E)."
        )

    comentario = nullable_text(raw.get("gabarito comentado")) or nullable_text(
        raw.get("comentarios")
    )

    return {
        "banca": concurso,
        "ano": extract_ano(concurso),
        "cargo": None,
        "materia": materia,
        "tipo": tipo,
        "enunciado": enunciado,
        "alternativa_a": nullable_text(alts.get("a")),
        "alternativa_b": nullable_text(alts.get("b")),
        "alternativa_c": nullable_text(alts.get("c")),
        "alternativa_d": nullable_text(alts.get("d")),
        "alternativa_e": nullable_text(alts.get("e")),
        "gabarito": gabarito,
        "comentario": comentario,
        "dificuldade": "media",
    }


def iter_afirmacoes(raw: dict[str, Any]) -> list[tuple[str, str, int]]:
    """Lista (numero, enunciado, ordem) para questao_itens."""
    aff = raw.get("afirmações") or raw.get("afirmacoes")
    if isinstance(aff, dict) and aff:
        out: list[tuple[str, str, int]] = []
        ordem = 0
        for key in ROMAN_KEYS:
            txt = aff.get(key)
            s = nullable_text(txt)
            if s:
                ordem += 1
                out.append((key, s, ordem))
        if out:
            return out

    itens = raw.get("itens")
    if isinstance(itens, list) and itens:
        out2: list[tuple[str, str, int]] = []
        ordem2 = 0
        roman_norm = {"I": "I", "II": "II", "III": "III", "IV": "IV", "V": "V"}
        for line in itens:
            if not isinstance(line, str):
                continue
            m = _ITEM_ROMAN_RE.match(line.strip())
            if not m:
                continue
            label = m.group(1).upper()
            key = roman_norm.get(label)
            if not key:
                continue
            txt = nullable_text(m.group(2))
            if not txt:
                continue
            ordem2 += 1
            out2.append((key, txt, ordem2))
        return out2

    return []


def insert_questao_and_itens(cur, row_q: dict[str, Any], itens: list[tuple[str, str, int]]) -> None:
    cur.execute(
        """
        INSERT INTO questoes (
            banca, ano, cargo, materia, tipo, enunciado,
            alternativa_a, alternativa_b, alternativa_c, alternativa_d, alternativa_e,
            gabarito, comentario, dificuldade
        ) VALUES (
            %(banca)s, %(ano)s, %(cargo)s, %(materia)s, %(tipo)s, %(enunciado)s,
            %(alternativa_a)s, %(alternativa_b)s, %(alternativa_c)s, %(alternativa_d)s, %(alternativa_e)s,
            %(gabarito)s, %(comentario)s, %(dificuldade)s
        )
        RETURNING id
        """,
        row_q,
    )
    qid = cur.fetchone()[0]

    for numero, enunciado, ordem in itens:
        cur.execute(
            """
            INSERT INTO questao_itens (questao_id, numero, enunciado, correto, ordem)
            VALUES (%s, %s, %s, NULL, %s)
            """,
            (qid, numero, enunciado, ordem),
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Bulk insert de questões TAO a partir de JSON (Supabase/Postgres)."
    )
    parser.add_argument(
        "json_path",
        type=Path,
        help="Ficheiro JSON com array de questões (contrato no docstring).",
    )
    args = parser.parse_args()

    path = args.json_path.resolve()
    if not path.is_file():
        print(f"Erro: ficheiro não encontrado: {path}", file=sys.stderr)
        sys.exit(1)

    raw_text = path.read_text(encoding="utf-8")
    data = json.loads(raw_text)
    questoes = normalize_questoes_list(data)

    import psycopg2

    db_url = _ensure_db_url()
    n_q = 0
    n_i = 0
    conn = None

    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = False
        with conn.cursor() as cur:
            for i, raw in enumerate(questoes):
                if not isinstance(raw, dict):
                    print(f"Aviso: entrada #{i+1} ignorada (não é objeto).", file=sys.stderr)
                    continue
                try:
                    itens = iter_afirmacoes(raw)
                    tipo = "combinacao_itens" if itens else "multipla_escolha"
                    row_q = map_questao_row(raw, tipo=tipo)
                    insert_questao_and_itens(cur, row_q, itens)
                    n_q += 1
                    n_i += len(itens)
                except Exception as exc:
                    conn.rollback()
                    print(f"Erro na questão #{i+1}: {exc}", file=sys.stderr)
                    raise
            conn.commit()
    finally:
        if conn is not None:
            conn.close()

    print(f"Concluído: {n_q} questão(ões) inserida(s), {n_i} linha(s) em questao_itens.")


if __name__ == "__main__":
    main()
