"""Interactive Lesson and Learning Companion API router.

Strict Security & Design Requirements:
- Strictly scoped to current_user.id and course_id at the SQL level.
- Uploaded materials and external resources treated as untrusted data.
- Automatically synchronizes lesson completion with RoadmapItem task and day completion.
- Context-aware companion lesson tutor.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.ai.lesson.lesson_gen import generate_lesson_for_task
from app.ai.tutor.graph import tutor_app
from app.api.schemas import (
    LessonChatRequest,
    LessonChatResponse,
    LessonProgressResponse,
    LessonProgressUpdateRequest,
    LessonResponse,
    SourceReference,
)
from app.buddy.tone import ToneContext
from app.core.auth import get_current_user
from app.db.models import Lesson, LessonProgress, Mastery, RoadmapItem, User
from app.db.session import get_db

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/courses/{course_id}/roadmap/{item_id}/tasks/{task_id}/lesson",
    tags=["lessons"],
)


@router.get("", response_model=LessonResponse)
def get_lesson(
    course_id: int,
    item_id: int,
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LessonResponse:
    """Retrieve an existing generated lesson for a roadmap task."""
    lesson = (
        db.query(Lesson)
        .filter(
            Lesson.course_id == course_id,
            Lesson.roadmap_item_id == item_id,
            Lesson.task_id == task_id,
            Lesson.user_id == current_user.id,
        )
        .first()
    )
    if not lesson:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lesson not found for this study task. Click 'Start Learning' to generate it.",
        )

    return LessonResponse.model_validate(lesson)


@router.post("", response_model=LessonResponse)
async def generate_lesson_endpoint(
    course_id: int,
    item_id: int,
    task_id: str,
    overwrite: bool = Query(default=False, description="Set True to regenerate study notes"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LessonResponse:
    """Generate or retrieve complete structured lesson notes, resources, videos, and exercises."""
    lesson = await generate_lesson_for_task(
        course_id=course_id,
        roadmap_item_id=item_id,
        task_id=task_id,
        user_id=current_user.id,
        db=db,
        overwrite=overwrite,
    )
    return LessonResponse.model_validate(lesson)


@router.get("/progress", response_model=LessonProgressResponse)
def get_lesson_progress(
    course_id: int,
    item_id: int,
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LessonProgressResponse:
    """Retrieve learner progress, exercise attempts, and quiz score for this lesson."""
    lesson = (
        db.query(Lesson)
        .filter(
            Lesson.course_id == course_id,
            Lesson.roadmap_item_id == item_id,
            Lesson.task_id == task_id,
            Lesson.user_id == current_user.id,
        )
        .first()
    )
    if not lesson:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lesson not found",
        )

    progress = (
        db.query(LessonProgress)
        .filter(
            LessonProgress.lesson_id == lesson.id,
            LessonProgress.user_id == current_user.id,
        )
        .first()
    )
    if not progress:
        # Create initial record if missing
        progress = LessonProgress(
            lesson_id=lesson.id,
            user_id=current_user.id,
            course_id=course_id,
            sections_completed=[],
            exercises_completed={},
            completed=False,
            time_spent_seconds=0,
        )
        db.add(progress)
        db.commit()
        db.refresh(progress)

    return LessonProgressResponse.model_validate(progress)


@router.patch("/progress", response_model=LessonProgressResponse)
def update_lesson_progress(
    course_id: int,
    item_id: int,
    task_id: str,
    payload: LessonProgressUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LessonProgressResponse:
    """Update section reading progress, exercise attempts, knowledge check scores, or completion state."""
    lesson = (
        db.query(Lesson)
        .filter(
            Lesson.course_id == course_id,
            Lesson.roadmap_item_id == item_id,
            Lesson.task_id == task_id,
            Lesson.user_id == current_user.id,
        )
        .first()
    )
    if not lesson:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lesson not found",
        )

    progress = (
        db.query(LessonProgress)
        .filter(
            LessonProgress.lesson_id == lesson.id,
            LessonProgress.user_id == current_user.id,
        )
        .first()
    )
    if not progress:
        progress = LessonProgress(
            lesson_id=lesson.id,
            user_id=current_user.id,
            course_id=course_id,
            sections_completed=[],
            exercises_completed={},
            completed=False,
            time_spent_seconds=0,
        )
        db.add(progress)
        db.commit()
        db.refresh(progress)

    # 1. Update completed sections
    if payload.section_id is not None:
        sections = list(progress.sections_completed or [])
        if payload.section_completed:
            if payload.section_id not in sections:
                sections.append(payload.section_id)
        else:
            if payload.section_id in sections:
                sections.remove(payload.section_id)
        progress.sections_completed = sections
        flag_modified(progress, "sections_completed")

    # 2. Update exercise attempt
    if payload.exercise_id is not None and payload.exercise_attempt is not None:
        exercises = dict(progress.exercises_completed or {})
        exercises[payload.exercise_id] = payload.exercise_attempt
        progress.exercises_completed = exercises
        flag_modified(progress, "exercises_completed")

    # 3. Update quiz score
    if payload.quiz_score is not None:
        progress.quiz_score = payload.quiz_score
        progress.quiz_completed = True

        # Update topic mastery if topic associated
        if lesson.topic_id:
            mastery_rec = (
                db.query(Mastery)
                .filter(
                    Mastery.course_id == course_id,
                    Mastery.topic_id == lesson.topic_id,
                    Mastery.user_id == current_user.id,
                )
                .first()
            )
            normalized_score = max(0.0, min(1.0, payload.quiz_score / 100.0 if payload.quiz_score > 1.0 else payload.quiz_score))
            if mastery_rec:
                mastery_rec.attempts_count += 1
                # Smooth moving average
                mastery_rec.score = round(0.7 * mastery_rec.score + 0.3 * normalized_score, 4)
            else:
                mastery_rec = Mastery(
                    user_id=current_user.id,
                    course_id=course_id,
                    topic_id=lesson.topic_id,
                    score=normalized_score,
                    attempts_count=1,
                )
                db.add(mastery_rec)

    # 4. Update time spent
    if payload.add_time_seconds and payload.add_time_seconds > 0:
        progress.time_spent_seconds = (progress.time_spent_seconds or 0) + payload.add_time_seconds

    # 5. Update reflection
    if payload.reflection is not None:
        progress.reflection = payload.reflection

    # 6. Update completion state & propagate to RoadmapItem
    if payload.completed is not None:
        progress.completed = payload.completed

        roadmap_item = (
            db.query(RoadmapItem)
            .filter(
                RoadmapItem.id == item_id,
                RoadmapItem.course_id == course_id,
                RoadmapItem.user_id == current_user.id,
            )
            .first()
        )
        if roadmap_item:
            tasks = list(roadmap_item.tasks or [])
            for t in tasks:
                if t.get("id") == task_id:
                    t["completed"] = payload.completed
                    break
            roadmap_item.tasks = tasks
            flag_modified(roadmap_item, "tasks")

            # Check if all tasks for the day are complete
            if tasks and all(t.get("completed", False) for t in tasks):
                roadmap_item.completed = True
            elif not payload.completed:
                roadmap_item.completed = False

    progress.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(progress)

    return LessonProgressResponse.model_validate(progress)


@router.post("/chat", response_model=LessonChatResponse)
async def lesson_chat_tutor(
    course_id: int,
    item_id: int,
    task_id: str,
    payload: LessonChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LessonChatResponse:
    """Companion tutor with targeted, grounded context from this lesson and course materials."""
    lesson = (
        db.query(Lesson)
        .filter(
            Lesson.course_id == course_id,
            Lesson.roadmap_item_id == item_id,
            Lesson.task_id == task_id,
            Lesson.user_id == current_user.id,
        )
        .first()
    )
    if not lesson:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lesson not found",
        )

    # Inject targeted lesson context into message
    context_prefix = (
        f"[Context: Lesson '{lesson.title}', Topic '{lesson.topic.name if lesson.topic else lesson.title}']"
    )
    if payload.current_section_title:
        context_prefix += f" [Active Section: '{payload.current_section_title}']"
    if payload.current_exercise_id:
        context_prefix += f" [Active Exercise: '{payload.current_exercise_id}']"

    enriched_query = f"{context_prefix} {payload.message}"

    tone_ctx = ToneContext(
        quiz_active=(payload.current_exercise_id is not None),
        user_tone_setting=payload.user_tone_setting,
    )

    result = await tutor_app.ainvoke(
        {
            "db": db,
            "user_id": current_user.id,
            "course_id": course_id,
            "message": enriched_query,
            "tone_context": tone_ctx,
        }
    )

    sources = [
        SourceReference(
            document_id=s.get("document_id", 0),
            document_name=s.get("document_name", ""),
            page=s.get("page", 1),
            chunk_id=s.get("chunk_id"),
            heading=s.get("heading"),
        )
        for s in result.get("sources", [])
    ]

    return LessonChatResponse(
        reply=result.get("final_reply", ""),
        clean_answer=result.get("clean_answer"),
        sources=sources,
        citations=result.get("citations", []),
        tone=result.get("tone", "patient"),
    )
