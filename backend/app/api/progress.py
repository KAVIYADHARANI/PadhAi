"""Course progress and mastery endpoints.

Follows BUILD_PLAYBOOK.md Phase 3 Task 3B:
- GET /api/progress/{course_id}: returns mastery by topic and ranked weak topics.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.schemas import ProgressResponse, TopicMasteryItem
from app.core.auth import get_current_user
from app.db.models import Course, Topic, User
from app.db.models import Mastery as MasteryModel
from app.db.session import get_db
from app.learning.weak_topics import weak_topics

router = APIRouter(prefix="/api/progress", tags=["progress"])


@router.get("/{course_id}", response_model=ProgressResponse, status_code=status.HTTP_200_OK)
def get_course_progress(
    course_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ProgressResponse:
    """Retrieve topic mastery overview and ranked weak topics for a course."""
    # 1. Enforce course ownership at SQL level
    course = (
        db.query(Course).filter(Course.id == course_id, Course.user_id == current_user.id).first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or access denied.",
        )

    # 2. Fetch all topics for course
    topics = db.query(Topic).filter(Topic.course_id == course_id).all()

    # 3. Fetch all mastery records for this user and course
    masteries = (
        db.query(MasteryModel)
        .filter(
            MasteryModel.user_id == current_user.id,
            MasteryModel.course_id == course_id,
        )
        .all()
    )
    mastery_by_topic = {m.topic_id: m for m in masteries}

    # 4. Build TopicMasteryItem list
    now = datetime.now(UTC)
    topic_items: list[TopicMasteryItem] = []
    score_map: dict[int, float] = {}
    recency_map: dict[int, float] = {}

    for t in topics:
        m = mastery_by_topic.get(t.id)
        score = m.score if m else 0.0
        attempts_count = m.attempts_count if m else 0
        updated_at = m.updated_at if m else None

        score_map[t.id] = score
        if updated_at:
            ts = updated_at if updated_at.tzinfo is not None else updated_at.replace(tzinfo=UTC)
            days = max(0.0, (now - ts).total_seconds() / 86400.0)
            recency_map[t.id] = days
        else:
            recency_map[t.id] = 30.0  # Max unpracticed multiplier

        topic_items.append(
            TopicMasteryItem(
                topic_id=t.id,
                topic_name=t.name,
                score=score,
                attempts_count=attempts_count,
                updated_at=updated_at,
            )
        )

    # 5. Calculate ranked weak topics
    ranked_weak = weak_topics(
        mastery_by_topic=score_map,
        threshold=0.60,
        recency=recency_map,
    )

    return ProgressResponse(
        course_id=course_id,
        topics=topic_items,
        weak_topics=ranked_weak,
    )
