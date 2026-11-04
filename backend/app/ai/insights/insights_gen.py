"""Insights Agent.

Calculates pure SQL aggregates for mastery, quizzes, flashcards, roadmap, and study sessions,
then produces a concise progress report with one MODEL_FAST summary call.
Follows README Section 8: 'insights: SQL aggregates, then one short summary call.'
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import ModelRole
from app.core.config import settings
from app.db.models import Attempt, Course, Flashcard, Mastery, RoadmapItem, StudySession, Topic
from app.learning.weak_topics import weak_topics

logger = logging.getLogger(__name__)


def compute_course_insights_aggregates(
    course_id: int,
    user_id: int,
    db: Session,
) -> dict[str, Any]:
    """Computes SQL aggregates strictly filtered by course_id and user_id."""
    # 1. Topics and Mastery
    topics = db.query(Topic).filter(Topic.course_id == course_id).all()
    topic_map = {t.id: t.name for t in topics}

    masteries = (
        db.query(Mastery)
        .filter(Mastery.course_id == course_id, Mastery.user_id == user_id)
        .all()
    )
    mastery_scores: dict[int, float] = {m.topic_id: m.score for m in masteries}

    total_topics = len(topics)
    avg_mastery = (
        sum(mastery_scores.values()) / len(mastery_scores) if mastery_scores else 0.0
    )

    # Rank weak topics using learning engine algorithm
    ranked_weak_ids = weak_topics(
        mastery_by_topic=mastery_scores,
        threshold=0.60,
    )
    weak_topic_names = [topic_map[tid] for tid in ranked_weak_ids if tid in topic_map]
    strong_topic_names = [
        topic_map[tid]
        for tid, score in mastery_scores.items()
        if score >= 0.80 and tid in topic_map
    ]

    # 2. Quiz Attempts
    total_attempts = (
        db.query(func.count(Attempt.id))
        .filter(Attempt.course_id == course_id, Attempt.user_id == user_id)
        .scalar()
        or 0
    )
    correct_attempts = (
        db.query(func.count(Attempt.id))
        .filter(
            Attempt.course_id == course_id,
            Attempt.user_id == user_id,
            Attempt.correct == True,  # noqa: E712
        )
        .scalar()
        or 0
    )
    accuracy_pct = (
        round((correct_attempts / total_attempts) * 100.0, 1) if total_attempts > 0 else 0.0
    )

    # 3. Flashcards
    now = datetime.now(UTC)
    total_cards = (
        db.query(func.count(Flashcard.id))
        .filter(Flashcard.course_id == course_id, Flashcard.user_id == user_id)
        .scalar()
        or 0
    )
    due_cards = (
        db.query(func.count(Flashcard.id))
        .filter(
            Flashcard.course_id == course_id,
            Flashcard.user_id == user_id,
            Flashcard.due_date <= now,
        )
        .scalar()
        or 0
    )

    # 4. Roadmap Items
    roadmap_items = (
        db.query(RoadmapItem)
        .filter(RoadmapItem.course_id == course_id, RoadmapItem.user_id == user_id)
        .all()
    )
    total_days = len(roadmap_items)
    completed_days = sum(1 for item in roadmap_items if item.completed)
    roadmap_pct = (
        round((completed_days / total_days) * 100.0, 1) if total_days > 0 else 0.0
    )

    # 5. Study Sessions
    sessions = (
        db.query(StudySession)
        .filter(StudySession.course_id == course_id, StudySession.user_id == user_id)
        .all()
    )
    total_pomodoros = sum(s.pomodoros for s in sessions)
    focus_scores = [s.focus_avg for s in sessions if s.focus_avg is not None]
    avg_focus = (
        round(sum(focus_scores) / len(focus_scores), 1) if focus_scores else None
    )

    return {
        "course_id": course_id,
        "total_topics": total_topics,
        "average_mastery_pct": round(avg_mastery * 100.0, 1),
        "weak_topics": weak_topic_names,
        "strong_topics": strong_topic_names,
        "quiz_attempts": total_attempts,
        "quiz_accuracy_pct": accuracy_pct,
        "total_flashcards": total_cards,
        "due_flashcards": due_cards,
        "roadmap_days_total": total_days,
        "roadmap_days_completed": completed_days,
        "roadmap_progress_pct": roadmap_pct,
        "total_pomodoros": total_pomodoros,
        "average_focus_pct": avg_focus,
    }


def format_deterministic_insights_overview(aggregates: dict[str, Any]) -> str:
    """Builds a structured markdown summary of the student's progress metrics."""
    weak_str = (
        ", ".join(aggregates["weak_topics"][:3])
        if aggregates["weak_topics"]
        else "None! You're on track."
    )
    strong_str = (
        ", ".join(aggregates["strong_topics"][:3])
        if aggregates["strong_topics"]
        else "Keep practicing to build mastery."
    )

    lines = [
        "### 📊 Your Learning Progress Overview",
        "",
        f"- **Topic Mastery:** {aggregates['average_mastery_pct']}% average across {aggregates['total_topics']} topics",
        f"- **Quiz Accuracy:** {aggregates['quiz_accuracy_pct']}% ({aggregates['quiz_attempts']} attempts)",
        f"- **Flashcards:** {aggregates['due_flashcards']} cards due for review ({aggregates['total_flashcards']} total cards)",
        f"- **Roadmap Milestone:** {aggregates['roadmap_days_completed']}/{aggregates['roadmap_days_total']} days completed ({aggregates['roadmap_progress_pct']}%)",
        f"- **Focus Sessions:** {aggregates['total_pomodoros']} Pomodoros completed",
        "",
        f"**Areas needing focus:** {weak_str}",
        f"**Strongest concepts:** {strong_str}",
    ]
    return "\n".join(lines)


async def generate_insights_summary(
    course_id: int,
    user_id: int,
    db: Session,
    gateway: LLMGateway | None = None,
) -> tuple[str, dict[str, Any]]:
    """Generates an insights report combining SQL aggregates with a fast summary call.

    Returns (markdown_response, aggregates_dict).
    """
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.user_id == user_id)
        .first()
    )
    if not course:
        return ("Course not found.", {})

    aggregates = compute_course_insights_aggregates(course_id=course_id, user_id=user_id, db=db)
    base_overview = format_deterministic_insights_overview(aggregates)

    llm_gw = gateway or LLMGateway()

    # Fast 2-sentence study companion recommendation call
    summary_prompt = (
        f"You are {settings.MASCOT_NAME}, an encouraging study companion. "
        f"Given the student's study metrics:\n"
        f"- Average mastery: {aggregates['average_mastery_pct']}%\n"
        f"- Weak topics: {', '.join(aggregates['weak_topics'][:2]) or 'None'}\n"
        f"- Due flashcards: {aggregates['due_flashcards']}\n"
        f"- Roadmap progress: {aggregates['roadmap_progress_pct']}%\n\n"
        f"Write a friendly, 2-sentence encouraging takeaway and 1 concrete action recommendation for their study session today. "
        f"Keep it motivating and concise."
    )

    try:
        response = await llm_gw.chat_completion(
            messages=[
                {"role": "system", "content": "You are a warm, motivating study buddy. Be concise and actionable."},
                {"role": "user", "content": summary_prompt},
            ],
            role=ModelRole.FAST,
            temperature=0.2,
            max_tokens=100,
        )
        ai_recommendation = response.text.strip()
        full_report = f"{base_overview}\n\n**{settings.MASCOT_NAME}'s Tip:** {ai_recommendation}"
    except Exception as e:
        logger.debug("Insights LLM summary skipped, using deterministic overview: %s", e)
        full_report = base_overview

    return full_report, aggregates
