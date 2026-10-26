"""Flashcards and Spaced Repetition (SM-2) endpoints.

Follows BUILD_PLAYBOOK.md Phase 5 Task 5A:
- POST /api/flashcards/generate: Generates grounded active-recall flashcards from course/topic chunks.
- GET /api/flashcards/due: Retrieves flashcards that are due for review (due_date <= now()).
- GET /api/flashcards: Lists all flashcards for a course with optional topic filtering.
- POST /api/flashcards/{id}/review: Submits review rating (0 to 5) and updates intervals using SM-2.
- DELETE /api/flashcards/{id}: Deletes a flashcard.

Strict Security Rules:
- user_id ALWAYS comes from verified Firebase token via get_current_user.
- Every query filters by user_id and course_id at the SQL level.
- No raw text logged.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.ai.flashcards.flashcard_gen import generate_flashcards_for_topic
from app.ai.harness.gateway import LLMGateway
from app.api.schemas import (
    FlashcardGenerateRequest,
    FlashcardListResponse,
    FlashcardResponse,
    FlashcardReviewRequest,
    FlashcardReviewResponse,
)
from app.core.auth import get_current_user
from app.db.models import Course, Flashcard, User
from app.db.session import get_db
from app.learning.srs import calculate_sm2

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/flashcards", tags=["flashcards"])


def get_llm_gateway() -> LLMGateway:
    """Dependency provider for LLMGateway."""
    return LLMGateway()


@router.post("/generate", response_model=list[FlashcardResponse], status_code=status.HTTP_200_OK)
async def generate_flashcards(
    payload: FlashcardGenerateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    gateway: Annotated[LLMGateway, Depends(get_llm_gateway)],
) -> list[FlashcardResponse]:
    """Generate grounded flashcards for a course topic using MODEL_SMART."""
    # 1. Authorize course ownership
    course = (
        db.query(Course)
        .filter(Course.id == payload.course_id, Course.user_id == current_user.id)
        .first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    try:
        cards = await generate_flashcards_for_topic(
            db=db,
            gateway=gateway,
            course_id=payload.course_id,
            user_id=current_user.id,
            topic_id=payload.topic_id,
            count=payload.count,
        )
        return [FlashcardResponse.model_validate(card) for card in cards]
    except Exception as exc:
        logger.error(
            "Flashcard generation failed",
            extra={
                "course_id": payload.course_id,
                "user_id": current_user.id,
                "topic_id": payload.topic_id,
                "status": "error",
            },
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate flashcards. Please try again later.",
        ) from exc


def _is_due(card_due: datetime, now_dt: datetime) -> bool:
    """Robust comparison supporting both PostgreSQL timezone-aware and SQLite naive datetimes."""
    if card_due.tzinfo is None:
        return card_due <= now_dt.replace(tzinfo=None)
    return card_due <= now_dt


@router.get("/due", response_model=list[FlashcardResponse])
async def get_due_flashcards(
    course_id: Annotated[int, Query(description="Course ID to retrieve due flashcards for")],
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[FlashcardResponse]:
    """Retrieve flashcards that are due for review (due_date <= now())."""
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.user_id == current_user.id)
        .first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    now = datetime.now(UTC)
    cards = (
        db.query(Flashcard)
        .filter(
            Flashcard.course_id == course_id,
            Flashcard.user_id == current_user.id,
        )
        .order_by(Flashcard.due_date.asc())
        .all()
    )
    due_cards = [c for c in cards if _is_due(c.due_date, now)]

    return [FlashcardResponse.model_validate(c) for c in due_cards]


@router.get("", response_model=FlashcardListResponse)
async def list_flashcards(
    course_id: Annotated[int, Query(description="Course ID to list flashcards for")],
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    topic_id: Annotated[int | None, Query(description="Optional topic ID filter")] = None,
) -> FlashcardListResponse:
    """List all flashcards for a course, with counts of total and due cards."""
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.user_id == current_user.id)
        .first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    query = db.query(Flashcard).filter(
        Flashcard.course_id == course_id,
        Flashcard.user_id == current_user.id,
    )
    if topic_id is not None:
        query = query.filter(Flashcard.topic_id == topic_id)

    all_cards = query.order_by(Flashcard.created_at.desc()).all()
    now = datetime.now(UTC)
    due_count = sum(1 for c in all_cards if _is_due(c.due_date, now))

    return FlashcardListResponse(
        cards=[FlashcardResponse.model_validate(c) for c in all_cards],
        total_count=len(all_cards),
        due_count=due_count,
    )


@router.post("/{card_id}/review", response_model=FlashcardReviewResponse)
async def review_flashcard(
    card_id: int,
    payload: FlashcardReviewRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> FlashcardReviewResponse:
    """Submit a review rating (0 to 5) for a flashcard, updating intervals using SM-2."""
    card = (
        db.query(Flashcard)
        .filter(Flashcard.id == card_id, Flashcard.user_id == current_user.id)
        .first()
    )
    if not card:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Flashcard not found",
        )

    now = datetime.now(UTC)
    result = calculate_sm2(
        reps=card.reps,
        interval_days=card.interval_days,
        ease_factor=card.ease_factor,
        quality=payload.quality,
        now=now,
    )

    card.reps = result.reps
    card.interval_days = result.interval_days
    card.ease_factor = result.ease_factor
    card.due_date = result.due_date
    card.last_reviewed_at = now
    card.updated_at = now

    db.commit()
    db.refresh(card)

    logger.info(
        "Flashcard reviewed",
        extra={
            "course_id": card.course_id,
            "user_id": current_user.id,
            "status": "reviewed",
        },
    )

    return FlashcardReviewResponse(
        card=FlashcardResponse.model_validate(card),
        new_interval_days=result.interval_days,
        new_ease_factor=result.ease_factor,
        next_due_date=result.due_date,
    )


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_flashcard(
    card_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    """Delete a flashcard owned by the current user."""
    card = (
        db.query(Flashcard)
        .filter(Flashcard.id == card_id, Flashcard.user_id == current_user.id)
        .first()
    )
    if not card:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Flashcard not found",
        )

    db.delete(card)
    db.commit()
