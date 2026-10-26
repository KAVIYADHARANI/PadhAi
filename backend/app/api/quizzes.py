"""Quizzes and attempts endpoints.

Follows BUILD_PLAYBOOK.md Phase 3 Task 3B:
- POST /api/quizzes: Generates or retrieves grounded questions for a topic.
- POST /api/attempts: Grades answers deterministically, records attempts, and updates topic mastery.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.ai.harness.gateway import LLMGateway
from app.ai.quiz.quiz_gen import generate_quiz
from app.api.schemas import (
    AttemptResponse,
    AttemptSubmitRequest,
    QuizGenerateRequest,
    QuizQuestionItem,
    QuizResponse,
)
from app.core.auth import get_current_user
from app.db.models import Attempt, Course, Question, Topic, User
from app.db.models import Mastery as MasteryModel
from app.db.session import get_db
from app.learning.mastery import AttemptRecord, mastery_score

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["quizzes"])


def get_llm_gateway() -> LLMGateway:
    """Dependency provider for LLMGateway."""
    return LLMGateway()


@router.post("/quizzes", response_model=QuizResponse, status_code=status.HTTP_200_OK)
async def get_or_generate_quiz(
    payload: QuizGenerateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    gateway: Annotated[LLMGateway, Depends(get_llm_gateway)],
) -> QuizResponse:
    """Generate or retrieve grounded quiz questions for a course topic.

    Security: Course ownership verified at SQL level.
    Questions are strictly grounded in retrieved course study materials.
    """
    # 1. Enforce course ownership
    course = (
        db.query(Course)
        .filter(Course.id == payload.course_id, Course.user_id == current_user.id)
        .first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found or access denied.",
        )

    # 2. Verify topic belongs to course
    topic = (
        db.query(Topic)
        .filter(Topic.id == payload.topic_id, Topic.course_id == payload.course_id)
        .first()
    )
    if not topic:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Topic not found in course.",
        )

    # 3. Generate or retrieve questions
    try:
        questions = await generate_quiz(
            db=db,
            gateway=gateway,
            course_id=payload.course_id,
            topic_id=payload.topic_id,
            user_id=current_user.id,
            count=payload.count,
        )
    except Exception as e:
        logger.error("Failed to generate quiz: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unable to generate quiz for this topic: {e}",
        )

    question_items = [
        QuizQuestionItem(
            id=q.id,
            course_id=q.course_id,
            topic_id=q.topic_id,
            stem=q.stem,
            question_type=q.question_type or "mcq",
            options=q.options,
            difficulty=q.difficulty or 1.0,
        )
        for q in questions
    ]

    return QuizResponse(
        course_id=payload.course_id,
        topic_id=payload.topic_id,
        questions=question_items,
    )


@router.post("/attempts", response_model=AttemptResponse, status_code=status.HTTP_201_CREATED)
async def submit_attempt(
    payload: AttemptSubmitRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> AttemptResponse:
    """Submit an answer attempt for a quiz question.

    - Grades deterministically (case-insensitive string comparison).
    - Persists the attempt record.
    - Recalculates topic mastery with exponential recency decay.
    - Returns grading feedback and updated mastery score.
    """
    # 1. Fetch question
    question = db.query(Question).filter(Question.id == payload.question_id).first()
    if not question:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question not found.",
        )

    # 2. Verify course ownership for the question's course
    course = (
        db.query(Course)
        .filter(Course.id == question.course_id, Course.user_id == current_user.id)
        .first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to question for this course.",
        )

    # 3. Deterministic grading
    is_correct = payload.selected_answer.strip().lower() == question.answer.strip().lower()

    # 4. Save attempt
    attempt = Attempt(
        user_id=current_user.id,
        question_id=question.id,
        course_id=question.course_id,
        topic_id=question.topic_id,
        selected_answer=payload.selected_answer.strip(),
        correct=is_correct,
        time_ms=payload.time_ms,
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)

    # 5. Recalculate topic mastery
    history = (
        db.query(Attempt, Question.difficulty)
        .join(Question, Attempt.question_id == Question.id)
        .filter(
            Attempt.user_id == current_user.id,
            Attempt.topic_id == question.topic_id,
        )
        .order_by(Attempt.created_at.asc())
        .all()
    )

    attempt_records = [
        AttemptRecord(
            is_correct=att.correct,
            difficulty=diff if diff is not None else 1.0,
            timestamp=att.created_at,
        )
        for att, diff in history
    ]

    new_mastery = mastery_score(attempt_records)

    # 6. Upsert mastery row
    mastery_record = (
        db.query(MasteryModel)
        .filter(
            MasteryModel.user_id == current_user.id,
            MasteryModel.topic_id == question.topic_id,
        )
        .first()
    )
    if not mastery_record:
        mastery_record = MasteryModel(
            user_id=current_user.id,
            course_id=question.course_id,
            topic_id=question.topic_id,
            score=new_mastery,
            attempts_count=len(history),
        )
        db.add(mastery_record)
    else:
        mastery_record.score = new_mastery
        mastery_record.attempts_count = len(history)

    db.commit()

    return AttemptResponse(
        id=attempt.id,
        question_id=question.id,
        selected_answer=attempt.selected_answer,
        correct=attempt.correct,
        answer=question.answer,
        explanation=question.explanation,
        source_chunk_ids=question.source_chunk_ids,
        new_mastery_score=new_mastery,
        time_ms=attempt.time_ms,
        created_at=attempt.created_at,
    )
