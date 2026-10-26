"""Spaced Repetition System (SRS) based on the SuperMemo-2 (SM-2) algorithm.

This module provides a pure, deterministic implementation of SM-2 for flashcard scheduling.
It tracks repetition count, interval (in days), and ease factor (difficulty).

Interface Abstraction:
The SRS engine is exposed through standard data containers (SRSState, SRSReviewResult)
so that it can be replaced or enhanced with FSRS (Free Spaced Repetition Scheduler) in the
future without changing any caller contracts.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta


@dataclass(frozen=True)
class SRSState:
    """Represents the current scheduling state of a flashcard."""

    reps: int
    interval_days: int
    ease_factor: float
    due_date: datetime


@dataclass(frozen=True)
class SRSReviewResult:
    """Represents the updated scheduling state after a user review."""

    reps: int
    interval_days: int
    ease_factor: float
    due_date: datetime
    quality: int


MIN_EASE_FACTOR: float = 1.3
DEFAULT_EASE_FACTOR: float = 2.5


def calculate_sm2(
    reps: int,
    interval_days: int,
    ease_factor: float,
    quality: int,
    now: datetime | None = None,
) -> SRSReviewResult:
    """Computes the next review interval and ease factor according to SM-2.

    Parameters:
    - reps: Current successful repetition streak (0 or higher).
    - interval_days: Previous interval in days (0 or higher).
    - ease_factor: Current difficulty multiplier (minimum 1.3, default 2.5).
    - quality: Student rating from 0 to 5:
        5 - Perfect response, effortless recall.
        4 - Correct response after slight hesitation.
        3 - Correct response recalled with serious difficulty.
        2 - Incorrect response; correct answer seemed familiar.
        1 - Incorrect response; correct answer remembered upon seeing it.
        0 - Complete blackout.
    - now: The reference review timestamp (defaults to datetime.now(UTC)).

    Returns:
    - SRSReviewResult containing the updated reps, interval_days, ease_factor, and due_date.

    Algorithmic Rules:
    1. If quality >= 3 (Passing grades):
       - If reps == 0: interval = 1 day
       - Else if reps == 1: interval = 6 days
       - Else: interval = round(previous_interval * ease_factor)
       - reps += 1
    2. If quality < 3 (Failing grades):
       - reps = 0
       - interval = 1 day (reset back to initial review)
    3. Ease Factor:
       - EF' = EF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
       - EF' is clamped at a minimum of 1.3
    """
    if not (0 <= quality <= 5):
        raise ValueError(f"Review quality must be an integer between 0 and 5, got {quality}")

    current_time = now or datetime.now(UTC)

    # 1. Update Ease Factor
    # Formula: EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    ef_delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
    new_ef = round(max(MIN_EASE_FACTOR, ease_factor + ef_delta), 4)

    # 2. Determine repetitions and new interval
    if quality >= 3:
        # Successful recall
        if reps == 0:
            new_interval = 1
        elif reps == 1:
            new_interval = 6
        else:
            new_interval = max(1, int(round(interval_days * new_ef)))
        new_reps = reps + 1
    else:
        # Failure / forgotten: restart repetition sequence
        new_reps = 0
        new_interval = 1

    new_due_date = current_time + timedelta(days=new_interval)

    return SRSReviewResult(
        reps=new_reps,
        interval_days=new_interval,
        ease_factor=new_ef,
        due_date=new_due_date,
        quality=quality,
    )
