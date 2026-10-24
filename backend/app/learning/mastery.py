"""Mastery score calculation core for learning topics.

Pure deterministic functions without database or LLM dependencies.
Formula:
    w_i = difficulty_i * 2^(-days_ago_i / half_life)
    mastery = sum(w_i * is_correct_i) / sum(w_i)
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

DIFFICULTY_WEIGHTS = {
    "easy": 1.0,
    "medium": 1.5,
    "hard": 2.0,
}


@dataclass(frozen=True)
class AttemptRecord:
    """Single question attempt record."""

    is_correct: bool
    difficulty: float = 1.0
    days_ago: float = 0.0
    timestamp: datetime | None = None

    @classmethod
    def from_difficulty_name(
        cls,
        is_correct: bool,
        difficulty_name: str = "medium",
        days_ago: float = 0.0,
        timestamp: datetime | None = None,
    ) -> AttemptRecord:
        """Create attempt using named difficulty."""
        diff = DIFFICULTY_WEIGHTS.get(difficulty_name.lower(), 1.0)
        return cls(is_correct=is_correct, difficulty=diff, days_ago=days_ago, timestamp=timestamp)


def mastery_score(
    attempts: Sequence[AttemptRecord],
    half_life_days: float = 7.0,
    default_mastery: float = 0.0,
    reference_time: datetime | None = None,
) -> float:
    """Calculate the mastery score for a sequence of attempts in [0.0, 1.0].

    Properties:
    - Empty attempts returns default_mastery (0.0).
    - Monotonic: An additional correct attempt never decreases the score.
    - Recency weighting: Recent attempts weigh more than older ones (exponential decay).
    - Difficulty weighting: Harder questions contribute higher weight.
    """
    if not attempts:
        return default_mastery

    ref_now = reference_time or datetime.now(UTC)
    total_weight = 0.0
    weighted_correct = 0.0

    for att in attempts:
        # Calculate effective days ago
        if att.timestamp is not None:
            # Normalize naive datetimes to UTC if necessary
            ts = att.timestamp if att.timestamp.tzinfo is not None else att.timestamp.replace(tzinfo=UTC)
            delta = (ref_now - ts).total_seconds()
            effective_days_ago = max(0.0, delta / 86400.0)
        else:
            effective_days_ago = max(0.0, att.days_ago)

        # Exponential decay factor
        decay = 2.0 ** (-effective_days_ago / half_life_days)
        weight = max(0.01, att.difficulty) * decay

        total_weight += weight
        if att.is_correct:
            weighted_correct += weight

    if total_weight <= 0.0:
        return default_mastery

    score = weighted_correct / total_weight
    return max(0.0, min(1.0, round(score, 4)))
