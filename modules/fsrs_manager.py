"""
modules/fsrs_manager.py
Algoritmo FSRS v5 real usando a biblioteca `fsrs` ≥ 6.0.

Uso externo:
    from modules.fsrs_manager import schedule_review, fsrs_dot

    result = schedule_review(card_data, rating_str)
    # card_data: dict com stability, difficulty, fsrs_state, last_review
    # rating_str: "again" | "hard" | "good" | "easy"
    # result: dict com stability, difficulty, fsrs_state, next_review, last_review
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

try:
    from fsrs import Card, Rating, Scheduler, State
    _FSRS_OK = True
    _scheduler = Scheduler()
except ImportError:
    _FSRS_OK = False
    _scheduler = None

_RATING_MAP: dict[str, Any] = {}
if _FSRS_OK:
    _RATING_MAP = {
        "again": Rating.Again,
        "hard":  Rating.Hard,
        "good":  Rating.Good,
        "easy":  Rating.Easy,
    }

RATING_LABELS = {
    "again": "❌ Errei",
    "hard":  "😓 Difícil",
    "good":  "✅ Ok",
    "easy":  "⭐ Fácil",
}


def _build_card(card_data: dict) -> "Card":
    """
    Reconstrói um Card FSRS a partir dos dados armazenados no banco.
    Para cards novos (stability=0 / fsrs_state=0) retorna Card() limpo,
    pois o FSRS não aceita stability=0 em revisões subsequentes.
    """
    stab      = float(card_data.get("stability")  or 0.0)
    diff      = float(card_data.get("difficulty") or 0.0)
    state_int = int(card_data.get("fsrs_state") or 0)

    # Card novo — deixa o Scheduler inicializar internamente
    if state_int == 0 or stab == 0.0:
        return Card()

    card = Card()
    card.stability  = stab
    card.difficulty = diff
    try:
        card.state = State(state_int)
    except ValueError:
        card.state = State.Learning

    lr = card_data.get("last_review")
    if lr:
        try:
            if isinstance(lr, str):
                card.last_review = datetime.fromisoformat(lr).replace(tzinfo=timezone.utc)
            elif isinstance(lr, date) and not isinstance(lr, datetime):
                card.last_review = datetime(lr.year, lr.month, lr.day, tzinfo=timezone.utc)
            else:
                card.last_review = lr
        except Exception:
            pass

    return card


def schedule_review(card_data: dict, rating_str: str = "good") -> dict:
    """
    Aplica FSRS e retorna campos atualizados para salvar no banco.

    Args:
        card_data   : dict com stability, difficulty, fsrs_state, last_review
        rating_str  : "again" | "hard" | "good" | "easy"

    Returns:
        dict com stability, difficulty, fsrs_state, next_review (str), last_review (str)
    """
    if not _FSRS_OK or _scheduler is None:
        return _fallback(card_data)

    rating   = _RATING_MAP.get(rating_str.lower(), Rating.Good)
    card     = _build_card(card_data)
    new_card, _ = _scheduler.review_card(card, rating)

    due_date  = new_card.due.date()  if new_card.due         else date.today()
    last_date = new_card.last_review.date() if new_card.last_review else date.today()

    return {
        "stability":  round(new_card.stability,  4),
        "difficulty": round(new_card.difficulty, 4),
        "fsrs_state": int(new_card.state),
        "next_review": str(due_date),
        "last_review": str(last_date),
    }


def _fallback(card_data: dict) -> dict:
    """Algoritmo simples para quando fsrs não estiver instalado."""
    from datetime import timedelta
    stab = float(card_data.get("stability")  or 1.0)
    diff = float(card_data.get("difficulty") or 0.3)
    nova = round(stab * (1 + 0.15 * max(0.05, 1.0 - diff)), 2)
    proxima = date.today() + timedelta(days=max(1, round(nova)))
    return {
        "stability":  nova,
        "difficulty": diff,
        "fsrs_state": 2,
        "next_review": str(proxima),
        "last_review": str(date.today()),
    }


def fsrs_dot(next_review) -> str:
    """Retorna emoji colorido conforme urgência de revisão."""
    if not next_review:
        return "⬜"
    try:
        diff = (date.fromisoformat(str(next_review)) - date.today()).days
        if diff > 7:
            return "🟢"
        elif diff >= 0:
            return "🟡"
        else:
            return "🔴"
    except (ValueError, TypeError):
        return "⬜"
