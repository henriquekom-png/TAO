"""
services/fsrs_service.py
========================
FSRS v5 business logic — ported from modules/fsrs_manager.py.

This module is **pure Python** (no Streamlit, no DB I/O) so it is trivially
testable and reusable from any async context.

Public API
----------
    from app.services.fsrs_service import schedule_review, urgency_dot, RatingStr

    result = schedule_review(card_data, "good")
    # → FSRSResult with stability, difficulty, reps, lapses, next_review, last_review

Rating map (numeric 1-4 used by the REST API → library enum)
-------------------------------------------------------------
    1 = Again  (again)
    2 = Hard   (hard)
    3 = Good   (good)   ← default
    4 = Easy   (easy)

The original Streamlit app accepted string grades ("again"|"hard"|"good"|"easy").
Both forms are supported here via RatingStr and RatingInt aliases.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field

# ── Typing aliases ────────────────────────────────────────────────────────────

RatingStr = Literal["again", "hard", "good", "easy"]
RatingInt = Literal[1, 2, 3, 4]

_STR_TO_INT: dict[RatingStr, RatingInt] = {
    "again": 1,
    "hard":  2,
    "good":  3,
    "easy":  4,
}
_INT_TO_STR: dict[RatingInt, RatingStr] = {v: k for k, v in _STR_TO_INT.items()}

# ── FSRS library bootstrap ───────────────────────────────────────────────────

try:
    from fsrs import Card, Rating, Scheduler, State as FSRSState

    _FSRS_OK    = True
    _scheduler  = Scheduler()

    _RATING_MAP: dict[str, Rating] = {
        "again": Rating.Again,
        "hard":  Rating.Hard,
        "good":  Rating.Good,
        "easy":  Rating.Easy,
    }
except ImportError:  # pragma: no cover
    _FSRS_OK   = False
    _scheduler = None
    _RATING_MAP = {}


# ── Data Transfer Object ──────────────────────────────────────────────────────

class FSRSResult(BaseModel):
    """Immutable snapshot of updated FSRS card state to write back to DB."""

    stability:   float = Field(..., ge=0.0)
    difficulty:  float = Field(..., ge=0.0, le=1.0)
    reps:        int   = Field(..., ge=0)
    lapses:      int   = Field(..., ge=0)
    # Stored as ISO date strings so they map cleanly to the DATE columns
    last_review: str   = Field(..., description="YYYY-MM-DD")
    next_review: str   = Field(..., description="YYYY-MM-DD")
    revisado:    bool  = Field(True)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _normalize_rating(grade: RatingStr | RatingInt) -> RatingStr:
    """Accept either the numeric (1-4) or string form and return the string."""
    if isinstance(grade, int):
        return _INT_TO_STR.get(grade, "good")  # type: ignore[return-value]
    return grade


def _build_card(bloco: dict) -> "Card":
    """
    Reconstruct an FSRS Card from the bloco row stored in Supabase.

    For brand-new cards (stability == 0 or state == 0) return a fresh Card()
    so the scheduler initialises it correctly.
    """
    stab      = float(bloco.get("stability")  or 0.0)
    diff      = float(bloco.get("difficulty") or 0.0)
    # The DB schema does not have an fsrs_state column; we derive state from reps.
    # 0 reps → New, >0 reps → Review (simplification sufficient for v5 re-entry)
    reps      = int(bloco.get("reps") or 0)

    if reps == 0 or stab == 0.0:
        return Card()

    card            = Card()
    card.stability  = stab
    card.difficulty = diff

    # Hydrate last_review so the scheduler can compute the correct interval
    lr = bloco.get("last_review")
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


def _fallback(bloco: dict, reps: int, lapses: int, is_again: bool) -> FSRSResult:
    """
    Simple interval formula used when the `fsrs` package is not installed.
    Mimics the Leitner-like logic from the original app's _fallback().
    """
    stab = float(bloco.get("stability") or 1.0)
    diff = float(bloco.get("difficulty") or 0.3)
    nova = round(stab * (1 + 0.15 * max(0.05, 1.0 - diff)), 2)
    interval_days = 1 if is_again else max(1, round(nova))
    next_dt = date.today() + timedelta(days=interval_days)
    new_lapses = lapses + (1 if is_again else 0)
    return FSRSResult(
        stability   = nova,
        difficulty  = diff,
        reps        = reps,
        lapses      = new_lapses,
        last_review = str(date.today()),
        next_review = str(next_dt),
        revisado    = True,
    )


# ── Public API ────────────────────────────────────────────────────────────────

def schedule_review(bloco: dict, grade: RatingStr | RatingInt = "good") -> FSRSResult:
    """
    Apply FSRS v5 and return the new card state to be written to the DB.

    Parameters
    ----------
    bloco : dict
        Current bloco row (or dict-like asyncpg Record) with keys:
        ``stability``, ``difficulty``, ``reps``, ``lapses``, ``last_review``.
    grade : RatingStr | RatingInt
        Review grade — string ("again"|"hard"|"good"|"easy") or integer (1-4).

    Returns
    -------
    FSRSResult
        Pydantic model ready to be unpacked into a DB UPDATE statement.
    """
    rating_str = _normalize_rating(grade)
    current_reps   = int(bloco.get("reps")   or 0)
    current_lapses = int(bloco.get("lapses") or 0)
    is_again       = (rating_str == "again")

    if not _FSRS_OK or _scheduler is None:
        return _fallback(bloco, current_reps + 1, current_lapses, is_again)

    rating   = _RATING_MAP[rating_str]
    card     = _build_card(bloco)
    new_card, _ = _scheduler.review_card(card, rating)

    due_date  = new_card.due.date()          if new_card.due         else date.today()
    last_date = new_card.last_review.date()  if new_card.last_review else date.today()

    # Clamp difficulty so it stays within the DB column's valid range [0, 1]
    clamped_diff = max(0.0, min(1.0, round(new_card.difficulty, 4)))

    new_lapses = current_lapses + (1 if is_again else 0)

    return FSRSResult(
        stability   = round(new_card.stability, 4),
        difficulty  = clamped_diff,
        reps        = current_reps + 1,
        lapses      = new_lapses,
        last_review = str(last_date),
        next_review = str(due_date),
        revisado    = True,
    )


def urgency_dot(next_review: Optional[str | date]) -> str:
    """
    Return a coloured dot emoji indicating review urgency.

    🟢  >7 days away
    🟡  Due within 7 days
    🔴  Overdue
    ⬜  Not yet scheduled
    """
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
