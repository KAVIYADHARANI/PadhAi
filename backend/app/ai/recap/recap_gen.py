"""Weekly Recap Generator.

Implements README Section 11.1 and Phase 7 Task 7C:
"The weekly recap is the only routine LLM use: ONE MODEL_FAST call over aggregates only (no text),
cached, with a fallback template if it fails."
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import ModelRole
from app.db.models import Attempt, Flashcard, Mastery, StudySession

logger = logging.getLogger(__name__)


class WeeklyRecapData(BaseModel):
    headline: str = Field(description="Inspiring, energetic 1-sentence weekly headline.")
    summary: str = Field(description="2-sentence encouraging summary of time and effort invested.")
    focus_highlight: str = Field(description="Specific highlight of study discipline and attention.")
    next_week_goal: str = Field(description="Actionable suggestion for the upcoming week.")
    is_fallback: bool = Field(default=False, description="True if generated from deterministic fallback.")


def compute_weekly_aggregates(
    course_id: int,
    user_id: int,
    db: Session,
    days: int = 7,
) -> dict[str, Any]:
    """Computes strictly numeric 7-day study aggregates.
    
    NEVER queries or passes document, message, or personal text.
    """
    cutoff = datetime.now(UTC) - timedelta(days=days)

    # 1. Study Sessions in last 7 days
    sessions = (
        db.query(StudySession)
        .filter(
            StudySession.course_id == course_id,
            StudySession.user_id == user_id,
            StudySession.started_at >= cutoff,
        )
        .all()
    )

    total_minutes = 0.0
    for s in sessions:
        if s.ended_at and s.started_at:
            total_minutes += max(0.0, (s.ended_at - s.started_at).total_seconds() / 60.0)
        else:
            total_minutes += (s.pomodoros or 1) * 25.0
    total_minutes = round(total_minutes, 1)

    focus_scores = [s.focus_avg for s in sessions if s.focus_avg is not None]
    avg_focus = round(sum(focus_scores) / len(focus_scores), 2) if focus_scores else 0.85

    drowsy_minutes_list = [s.drowsy_minutes for s in sessions if s.drowsy_minutes is not None]
    total_drowsy_minutes = round(sum(drowsy_minutes_list), 1)

    # 2. Quiz Attempts in last 7 days
    attempts = (
        db.query(Attempt)
        .filter(
            Attempt.course_id == course_id,
            Attempt.user_id == user_id,
            Attempt.created_at >= cutoff,
        )
        .all()
    )
    quizzes_taken = len(attempts)
    correct_count = sum(1 for a in attempts if a.is_correct)
    accuracy_pct = round((correct_count / quizzes_taken) * 100, 1) if quizzes_taken > 0 else 0.0

    # 3. Flashcards reviewed
    flashcard_count = (
        db.query(func.count(Flashcard.id))
        .filter(
            Flashcard.course_id == course_id,
            Flashcard.user_id == user_id,
            Flashcard.last_reviewed_at >= cutoff,
        )
        .scalar()
        or 0
    )

    # 4. Mastery count
    mastered_topics = (
        db.query(func.count(Mastery.id))
        .filter(
            Mastery.course_id == course_id,
            Mastery.user_id == user_id,
            Mastery.score >= 0.80,
        )
        .scalar()
        or 0
    )

    return {
        "days": days,
        "session_count": len(sessions),
        "total_minutes": total_minutes,
        "avg_focus": avg_focus,
        "drowsy_minutes": total_drowsy_minutes,
        "quizzes_taken": quizzes_taken,
        "accuracy_pct": accuracy_pct,
        "flashcards_reviewed": flashcard_count,
        "mastered_topics": mastered_topics,
    }


def deterministic_recap_fallback(aggregates: dict[str, Any]) -> WeeklyRecapData:
    """Deterministic fallback copy for weekly recap when LLM is unavailable or offline."""
    total_min = aggregates.get("total_minutes", 0)
    quizzes = aggregates.get("quizzes_taken", 0)
    focus = aggregates.get("avg_focus", 0.85)

    if total_min == 0 and quizzes == 0:
        return WeeklyRecapData(
            headline="Ready to kickstart your study week!",
            summary="You're all set to begin your learning sprint this week. Small steps every day create huge results.",
            focus_highlight="Every study session builds your neural pathways.",
            next_week_goal="Complete one 25-minute Pomodoro session to kick off your streak.",
            is_fallback=True,
        )

    focus_pct = int(focus * 100) if focus <= 1.0 else int(focus)

    return WeeklyRecapData(
        headline=f"Solid progress: {total_min} minutes logged this week!",
        summary=f"You completed {aggregates.get('session_count', 1)} study sessions and {quizzes} quiz questions with good dedication.",
        focus_highlight=f"Maintained an average focus rating of {focus_pct}%, staying sharp during study intervals.",
        next_week_goal="Aim to review your due flashcards daily and tackle one tricky topic quiz.",
        is_fallback=True,
    )


async def generate_weekly_recap(
    course_id: int,
    user_id: int,
    db: Session,
    gateway: LLMGateway | None = None,
) -> WeeklyRecapData:
    """Generates weekly recap using ONE MODEL_FAST call over strictly numeric aggregates."""
    aggregates = compute_weekly_aggregates(course_id, user_id, db)

    if not gateway:
        return deterministic_recap_fallback(aggregates)

    prompt = f"""You are a warm, supportive study recap generator for students.
Create an inspiring, concise weekly study recap using ONLY the following numeric aggregates:
- Total Study Time: {aggregates['total_minutes']} minutes across {aggregates['session_count']} sessions
- Average Focus Score: {aggregates['avg_focus']}
- Fatigue / Drowsy Minutes: {aggregates['drowsy_minutes']} minutes
- Quiz Questions Practiced: {aggregates['quizzes_taken']} (Accuracy: {aggregates['accuracy_pct']}%)
- Flashcards Reviewed: {aggregates['flashcards_reviewed']}
- Mastered Topics: {aggregates['mastered_topics']}

Provide JSON matching this schema:
{{
  "headline": "A short, motivating 1-sentence headline",
  "summary": "2 sentences celebrating effort and consistency",
  "focus_highlight": "1 sentence on focus and study habit consistency",
  "next_week_goal": "1 practical, actionable goal for next week"
}}
Never include diagnoses or guilt-tripping. Output raw JSON only."""

    try:
        from app.ai.harness.models import ChatMessage, LLMRequest

        request = LLMRequest(
            role=ModelRole.FAST,
            messages=[
                ChatMessage(role="system", content="You output only valid JSON."),
                ChatMessage(role="user", content=prompt),
            ],
            temperature=0.2,
            max_tokens=300,
        )
        call_result = await gateway.complete(request)

        import json
        content = call_result.content.strip()
        if content.startswith("```"):
            content = content.strip("`").replace("json\n", "", 1).strip()
        data = json.loads(content)

        return WeeklyRecapData(
            headline=data.get("headline", "Great learning week!"),
            summary=data.get("summary", "You made consistent progress towards your learning goals."),
            focus_highlight=data.get("focus_highlight", f"Maintained good focus with {aggregates['total_minutes']} minutes studied."),
            next_week_goal=data.get("next_week_goal", "Keep your momentum going with daily review."),
            is_fallback=False,
        )
    except Exception as exc:
        logger.warning("Weekly recap LLM generation failed, using deterministic fallback: %s", exc)
        return deterministic_recap_fallback(aggregates)
