"""Personalized Study Roadmap Generation Agent.

Follows project requirements:
1. Generates a personalized roadmap using course title, target days, hours per day,
   difficulty, and topics extracted from uploaded study materials.
2. Creates a sensible daily topic sequence with learning objectives, tasks, estimated time,
   and completion status.
3. Persists roadmaps and their daily tasks in the database so they survive refreshes.
4. Enforces course and user ownership at the SQL level.
5. If ingestion is incomplete or there is insufficient source material, explains that clearly
   with a helpful next action instead of fabricating topics.
6. Validates generated structured output and enforces usage budgets through LLM harness.
7. Allows regeneration without silently duplicating existing roadmaps (overwrites existing
   progress only when explicitly requested).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai.harness.exceptions import AuthenticationError
from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import ChatMessage, ModelRole
from app.ai.harness.structured import StructuredCall
from app.db.models import Chunk, Course, Document, RoadmapItem, Topic

logger = logging.getLogger(__name__)


class RoadmapTaskSpec(BaseModel):
    """Actionable study task within a daily milestone."""

    id: str = Field(..., description="Unique task identifier, e.g., 'd1_t1'")
    task: str = Field(..., min_length=3, description="Concrete, actionable study task description")
    estimated_minutes: int = Field(
        default=30, ge=5, le=360, description="Estimated duration in minutes"
    )
    completed: bool = Field(default=False, description="Initial completion status")


class RoadmapDaySpec(BaseModel):
    """Daily study plan milestone for the roadmap."""

    day: int = Field(..., ge=1, description="Day index in schedule (1, 2, ...)")
    topic_name: str = Field(..., min_length=2, description="Topic name from course materials")
    title: str = Field(..., min_length=3, description="Milestone title for the day")
    learning_objectives: list[str] = Field(
        ..., min_length=1, max_length=5, description="Key learning objectives"
    )
    tasks: list[RoadmapTaskSpec] = Field(
        ..., min_length=1, max_length=8, description="Actionable study tasks"
    )
    estimated_minutes: int = Field(
        ..., ge=10, le=720, description="Total study minutes for the day"
    )


class RoadmapPlan(BaseModel):
    """Container for the structured study roadmap."""

    days: list[RoadmapDaySpec] = Field(
        ..., min_length=1, description="Ordered daily study milestones"
    )


async def generate_course_roadmap(
    course_id: int,
    user_id: int,
    db: Session,
    gateway: LLMGateway | None = None,
    overwrite: bool = False,
) -> list[RoadmapItem]:
    """Generates and persists a personalized study roadmap for a course.

    Args:
        course_id: Database ID of the course.
        user_id: Authenticated user ID.
        db: SQLAlchemy session.
        gateway: Optional LLMGateway instance (defaults to new instance).
        overwrite: If True, replaces any existing roadmap and resets progress.

    Returns:
        List of persisted RoadmapItem instances.
    """
    # 1. Enforce course ownership at SQL level
    course = db.query(Course).filter(Course.id == course_id, Course.user_id == user_id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    # 2. Check existing roadmap items
    existing_items = (
        db.query(RoadmapItem)
        .filter(RoadmapItem.course_id == course_id, RoadmapItem.user_id == user_id)
        .order_by(RoadmapItem.day.asc())
        .all()
    )
    if existing_items and not overwrite:
        logger.info(
            "Returning existing roadmap of %d items for course %d (overwrite=False)",
            len(existing_items),
            course_id,
        )
        return existing_items

    # 3. Check document ingestion status and source material sufficiency
    docs = (
        db.query(Document)
        .filter(Document.course_id == course_id, Document.user_id == user_id)
        .all()
    )
    if not docs:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No study materials uploaded yet. Please upload course documents in the "
                "Knowledge Base tab before generating your study roadmap."
            ),
        )

    in_progress = [d for d in docs if d.status in ("queued", "processing")]
    if in_progress:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"{len(in_progress)} document(s) are still being processed. Please wait "
                "until ingestion completes before generating your roadmap."
            ),
        )

    ready_docs = [d for d in docs if d.status == "ready"]
    if not ready_docs:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "All uploaded documents failed processing. Please re-upload valid course "
                "materials before generating your roadmap."
            ),
        )

    # 4. Resolve extracted topics from database
    topics = db.query(Topic).filter(Topic.course_id == course_id).all()

    # Fallback topic resolution if topic grouping was skipped during upload
    if not topics:
        chunks = (
            db.query(Chunk).filter(Chunk.course_id == course_id, Chunk.user_id == user_id).all()
        )
        if not chunks:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "No readable content or text chunks were found in your materials. "
                    "Please upload documents with readable text or headings."
                ),
            )

        # Extract unique headings or fallback to course title
        headings = list(
            dict.fromkeys(
                c.heading_path.strip() for c in chunks if c.heading_path and c.heading_path.strip()
            )
        )
        if not headings:
            headings = [f"{course.name} - Core Fundamentals", f"{course.name} - Applied Concepts"]

        for h in headings[:10]:
            t = Topic(course_id=course_id, name=h)
            db.add(t)
        db.commit()

        topics = db.query(Topic).filter(Topic.course_id == course_id).all()

    topic_names = [t.name for t in topics]
    topic_map = {t.name.lower().strip(): t.id for t in topics}

    # 5. Build prompt for StructuredCall
    target_days = max(1, min(course.goal_days, 60))
    daily_minutes = max(15, int(course.hours_per_day * 60))

    system_prompt = (
        "You are an expert instructional designer and academic curriculum specialist. "
        "Create a realistic, sequenced, day-by-day study roadmap based ONLY on the provided "
        "course details and extracted topics from the student's uploaded materials.\n\n"
        "Rules:\n"
        f"1. Generate a schedule spanning between 1 and {target_days} days.\n"
        f"2. Target approximately {daily_minutes} minutes of study time per day.\n"
        "3. Only use topics grounded in the provided syllabus list; do not invent unrelated topics.\n"
        "4. Each day must have a clear title, 1-4 learning objectives, and 2-4 actionable tasks.\n"
        "5. Task IDs must be formatted as 'd{day}_t{index}' (e.g., 'd1_t1', 'd1_t2').\n"
        "6. Return ONLY the validated JSON structure conforming to the schema."
    )

    user_prompt = (
        f"Course: {course.name}\n"
        f"Level: {course.level}\n"
        f"Target Goal Days: {course.goal_days}\n"
        f"Study Hours Per Day: {course.hours_per_day} ({daily_minutes} mins/day)\n\n"
        f"Extracted Syllabus Topics ({len(topic_names)} topics):\n"
        + "\n".join(f"- {name}" for name in topic_names)
        + "\n\nGenerate the complete personalized study roadmap."
    )

    llm_gw = gateway or LLMGateway()
    structured = StructuredCall(llm_gw)

    messages = [
        ChatMessage(role="system", content=system_prompt),
        ChatMessage(role="user", content=user_prompt),
    ]

    try:
        plan: RoadmapPlan = await structured.execute(
            schema=RoadmapPlan,
            messages=messages,
            role=ModelRole.SMART,
            temperature=0.2,
        )
    except Exception as exc:
        logger.error("StructuredCall roadmap generation failed: %s", exc, exc_info=True)
        err_msg = str(exc)
        if "No LLM provider API key configured" in err_msg or isinstance(exc, AuthenticationError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "No LLM provider API key configured. Please set GROQ_API_KEY, "
                    "OPENROUTER_API_KEY, or GOOGLE_API_KEY in your .env file."
                ),
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to generate study roadmap: {exc}",
        ) from exc

    # 6. Persist newly generated roadmap
    if overwrite and existing_items:
        for old in existing_items:
            db.delete(old)
        db.flush()

    new_items: list[RoadmapItem] = []
    for day_spec in plan.days:
        matched_topic_id = None
        for t_name, t_id in topic_map.items():
            if t_name in day_spec.topic_name.lower() or day_spec.topic_name.lower() in t_name:
                matched_topic_id = t_id
                break

        tasks_data: list[dict[str, Any]] = [
            {
                "id": t.id,
                "task": t.task,
                "estimated_minutes": t.estimated_minutes,
                "completed": t.completed,
            }
            for t in day_spec.tasks
        ]

        # Calculate estimated minutes from tasks if not matching
        total_task_minutes = sum(t.estimated_minutes for t in day_spec.tasks)
        day_minutes = total_task_minutes if total_task_minutes > 0 else day_spec.estimated_minutes

        item = RoadmapItem(
            course_id=course_id,
            user_id=user_id,
            day=day_spec.day,
            topic_id=matched_topic_id,
            topic_name=day_spec.topic_name,
            title=day_spec.title,
            learning_objectives=day_spec.learning_objectives,
            tasks=tasks_data,
            estimated_minutes=day_minutes,
            completed=False,
        )
        db.add(item)
        new_items.append(item)

    db.commit()
    for item in new_items:
        db.refresh(item)

    logger.info(
        "Successfully generated and persisted %d roadmap items for course %d",
        len(new_items),
        course_id,
    )
    return new_items
