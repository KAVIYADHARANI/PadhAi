"""Personalized Study Roadmap API endpoints."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.ai.roadmap.roadmap_gen import generate_course_roadmap
from app.api.schemas import (
    RoadmapItemResponse,
    RoadmapItemUpdateRequest,
    RoadmapProgressResponse,
)
from app.core.auth import get_current_user
from app.db.models import Course, RoadmapItem, User
from app.db.session import get_db

router = APIRouter(prefix="/api/courses/{course_id}/roadmap", tags=["roadmap"])


def _calculate_progress(items: list[RoadmapItem], course_id: int) -> RoadmapProgressResponse:
    """Calculates overall course roadmap completion metrics."""
    total_days = len(items)
    completed_days = sum(1 for item in items if item.completed)

    total_tasks = 0
    completed_tasks = 0
    for item in items:
        tasks = item.tasks or []
        total_tasks += len(tasks)
        completed_tasks += sum(1 for t in tasks if t.get("completed", False))

    if total_tasks > 0:
        percent = round((completed_tasks / total_tasks) * 100.0, 1)
    elif total_days > 0:
        percent = round((completed_days / total_days) * 100.0, 1)
    else:
        percent = 0.0

    return RoadmapProgressResponse(
        course_id=course_id,
        total_days=total_days,
        completed_days=completed_days,
        total_tasks=total_tasks,
        completed_tasks=completed_tasks,
        percent_complete=percent,
        items=[RoadmapItemResponse.model_validate(item) for item in items],
    )


@router.get("", response_model=RoadmapProgressResponse)
def get_course_roadmap(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RoadmapProgressResponse:
    """Retrieves the personalized study roadmap and progress for a course.

    Strictly scoped to the authenticated user and course ID at the SQL level.
    """
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

    items = (
        db.query(RoadmapItem)
        .filter(RoadmapItem.course_id == course_id, RoadmapItem.user_id == current_user.id)
        .order_by(RoadmapItem.day.asc())
        .all()
    )
    return _calculate_progress(items, course_id)


@router.post("", response_model=RoadmapProgressResponse)
async def generate_roadmap_endpoint(
    course_id: int,
    overwrite: bool = Query(default=False, description="Set True to regenerate and reset progress"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RoadmapProgressResponse:
    """Generates a personalized study roadmap from uploaded course materials.

    Validates that materials are processed and ready. Uses StructuredCall with SMART model.
    """
    items = await generate_course_roadmap(
        course_id=course_id,
        user_id=current_user.id,
        db=db,
        overwrite=overwrite,
    )
    return _calculate_progress(items, course_id)


@router.patch("/{item_id}", response_model=RoadmapItemResponse)
def update_roadmap_item_progress(
    course_id: int,
    item_id: int,
    payload: RoadmapItemUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RoadmapItemResponse:
    """Updates progress for a roadmap day or individual study task.

    Strictly scoped to the authenticated user and course ID at the SQL level.
    """
    item = (
        db.query(RoadmapItem)
        .filter(
            RoadmapItem.id == item_id,
            RoadmapItem.course_id == course_id,
            RoadmapItem.user_id == current_user.id,
        )
        .first()
    )
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Roadmap item not found",
        )

    # 1. Update task completion status if task_id specified
    tasks = list(item.tasks or [])
    if payload.task_id is not None and payload.task_completed is not None:
        matched = False
        for t in tasks:
            if t.get("id") == payload.task_id:
                t["completed"] = payload.task_completed
                matched = True
                break
        if not matched:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Task with ID '{payload.task_id}' not found in this roadmap item",
            )
        item.tasks = tasks
        flag_modified(item, "tasks")

        # Automatically mark day complete if all tasks completed
        if tasks and all(t.get("completed", False) for t in tasks):
            item.completed = True
        else:
            item.completed = False

    # 2. Update day completion status directly if requested
    if payload.completed is not None:
        item.completed = payload.completed
        # If marking day complete, mark all constituent tasks complete
        if payload.completed:
            for t in tasks:
                t["completed"] = True
            item.tasks = tasks
            flag_modified(item, "tasks")

    item.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(item)

    return RoadmapItemResponse.model_validate(item)
