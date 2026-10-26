"""Personalized Study Roadmap Generation Agent.

Follows project requirements (README Section 12 & BUILD_PLAYBOOK Phase 5B):
1. Pure deterministic planner (app.learning.planner) computes the schedule,
   sequencing, task counts, and time allotments based on mastery and learner level.
2. ONE MODEL_FAST call writes only the wording (titles, objectives, task phrasing).
3. Strict validation guarantees that LLM wording output CANNOT alter topics, days,
   or task counts/durations determined by the planner.
4. Persists roadmaps and their daily tasks in the database so they survive refreshes.
5. Enforces course and user ownership at the SQL level.
6. Provides replan_course_roadmap that preserves completed items while redistributing
   remaining days according to updated mastery scores.
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
from app.db.models import Chunk, Course, Document, Mastery, RoadmapItem, Topic
from app.learning.planner import (
    PlannedDay,
    TopicInfo,
    plan_course_schedule,
    replan_roadmap,
)

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
    """Daily study plan milestone for the roadmap wording."""

    day: int = Field(..., ge=1, description="Day index in schedule (1, 2, ...)")
    topic_name: str | None = Field(default=None, description="Topic name from course materials")
    title: str = Field(..., min_length=3, description="Milestone title for the day")
    learning_objectives: list[str] = Field(
        default_factory=list, description="Key learning objectives"
    )
    tasks: list[RoadmapTaskSpec] | None = Field(
        default=None, description="Actionable study tasks"
    )
    task_descriptions: list[str] | None = Field(
        default=None, description="Alternative list of task descriptions"
    )
    estimated_minutes: int | None = Field(
        default=None, description="Total study minutes for the day"
    )


class RoadmapPlan(BaseModel):
    """Container for the structured study roadmap wording."""

    days: list[RoadmapDaySpec] = Field(
        ..., min_length=1, description="Ordered daily study milestones"
    )


def _apply_wording_to_plan(
    planned_days: list[PlannedDay],
    wording_days: list[RoadmapDaySpec],
    course_id: int,
    user_id: int,
) -> list[RoadmapItem]:
    """Applies LLM wording to the deterministic schedule with strict validation.

    CRITICAL INVARIANT: The LLM wording cannot alter topic_id, topic_name, day number,
    estimated_minutes, task IDs, or task counts determined by the planner.
    """
    wording_map = {w.day: w for w in wording_days}
    items: list[RoadmapItem] = []

    for plan in planned_days:
        wording = wording_map.get(plan.day)

        # Title: Take wording if valid, else fall back to deterministic title
        if wording and wording.title and len(wording.title.strip()) >= 3:
            final_title = wording.title.strip()
        else:
            final_title = plan.title

        # Learning Objectives: Take wording if valid, else fall back to deterministic
        if wording and wording.learning_objectives and len(wording.learning_objectives) > 0:
            final_objectives = [obj.strip() for obj in wording.learning_objectives if obj.strip()]
        else:
            final_objectives = list(plan.learning_objectives)

        # Tasks: Maintain planner's exact task count, IDs, and estimated minutes
        final_tasks: list[dict[str, Any]] = []
        for idx, task in enumerate(plan.tasks):
            desc = task.task
            if wording:
                if wording.tasks and idx < len(wording.tasks) and wording.tasks[idx].task:
                    desc = wording.tasks[idx].task.strip()
                elif (
                    wording.task_descriptions
                    and idx < len(wording.task_descriptions)
                    and wording.task_descriptions[idx]
                ):
                    desc = wording.task_descriptions[idx].strip()

            final_tasks.append(
                {
                    "id": task.id,
                    "task": desc,
                    "estimated_minutes": task.estimated_minutes,
                    "completed": task.completed,
                }
            )

        items.append(
            RoadmapItem(
                course_id=course_id,
                user_id=user_id,
                day=plan.day,
                topic_id=plan.topic_id,
                topic_name=plan.topic_name,  # Strictly preserved from planner
                title=final_title,
                learning_objectives=final_objectives,
                tasks=final_tasks,  # Strictly matches planner task count & times
                estimated_minutes=plan.estimated_minutes,  # Strictly preserved from planner
                completed=plan.completed,
            )
        )

    return items


async def _generate_wording_for_schedule(
    planned_days: list[PlannedDay],
    course: Course,
    gateway: LLMGateway | None = None,
) -> list[RoadmapDaySpec]:
    """Uses ONE MODEL_FAST call to write human-friendly titles, objectives, and tasks."""
    if not planned_days:
        return []

    schedule_summary = []
    for d in planned_days:
        schedule_summary.append(
            f"- Day {d.day}: Topic '{d.topic_name}' ({d.estimated_minutes} mins, {len(d.tasks)} tasks, is_review={d.is_review})"
        )

    system_prompt = (
        "You are an expert instructional curriculum writer. "
        "A deterministic study schedule has already been computed. Your job is ONLY to write "
        "clear, engaging milestone titles, 2-3 specific learning objectives, and actionable task "
        "descriptions for each day.\n\n"
        "STRICT CONSTRAINTS:\n"
        "1. DO NOT change the day numbers, topic names, or task counts.\n"
        "2. For each day, provide exactly the requested number of tasks.\n"
        "3. Ground all wording strictly in the assigned topic.\n"
        "4. Neutral, encouraging educational tone. No persona slang."
    )

    user_prompt = (
        f"Course: {course.name} ({course.level} level)\n"
        f"Target: {course.goal_days} days, {course.hours_per_day} hours/day\n\n"
        f"Computed Schedule:\n"
        + "\n".join(schedule_summary)
        + "\n\nWrite the wording for each day conforming to the schema."
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
            role=ModelRole.FAST,
            temperature=0.2,
        )
        return plan.days
    except Exception as exc:
        logger.warning(
            "MODEL_FAST wording generation failed: %s. Using deterministic fallback wording.",
            exc,
        )
        err_msg = str(exc)
        if "No LLM provider API key configured" in err_msg or isinstance(exc, AuthenticationError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "No LLM provider API key configured. Please set GROQ_API_KEY, "
                    "OPENROUTER_API_KEY, or GOOGLE_API_KEY in your .env file."
                ),
            ) from exc
        # Fall back gracefully to deterministic wording
        return [
            RoadmapDaySpec(
                day=d.day,
                topic_name=d.topic_name,
                title=d.title,
                learning_objectives=d.learning_objectives,
                tasks=[
                    RoadmapTaskSpec(
                        id=t.id,
                        task=t.task,
                        estimated_minutes=t.estimated_minutes,
                        completed=t.completed,
                    )
                    for t in d.tasks
                ],
                estimated_minutes=d.estimated_minutes,
            )
            for d in planned_days
        ]


async def generate_course_roadmap(
    course_id: int,
    user_id: int,
    db: Session,
    gateway: LLMGateway | None = None,
    overwrite: bool = False,
) -> list[RoadmapItem]:
    """Generates and persists a personalized study roadmap for a course."""
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

    # 3. Check document ingestion status
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

    # 5. Fetch mastery scores for course topics
    masteries = (
        db.query(Mastery)
        .filter(Mastery.course_id == course_id, Mastery.user_id == user_id)
        .all()
    )
    mastery_map = {m.topic_id: m.score for m in masteries}

    # 6. Run pure deterministic planner
    topic_infos = [TopicInfo(id=t.id, name=t.name) for t in topics]
    planned_days = plan_course_schedule(
        goal_days=course.goal_days,
        hours_per_day=course.hours_per_day,
        level=course.level,
        topics=topic_infos,
        mastery_by_topic=mastery_map,
    )

    # 7. Use ONE MODEL_FAST call to write wording
    wording_days = await _generate_wording_for_schedule(
        planned_days=planned_days,
        course=course,
        gateway=gateway,
    )

    # 8. Apply wording to planner's mathematical structure with strict validation
    new_items = _apply_wording_to_plan(
        planned_days=planned_days,
        wording_days=wording_days,
        course_id=course_id,
        user_id=user_id,
    )

    # 9. Persist roadmap
    if overwrite and existing_items:
        for old in existing_items:
            db.delete(old)
        db.flush()

    for item in new_items:
        db.add(item)
    db.commit()

    for item in new_items:
        db.refresh(item)

    logger.info(
        "Successfully generated and persisted %d roadmap items for course %d",
        len(new_items),
        course_id,
    )
    return new_items


async def replan_course_roadmap(
    course_id: int,
    user_id: int,
    db: Session,
    gateway: LLMGateway | None = None,
) -> list[RoadmapItem]:
    """Re-plans course roadmap based on updated topic mastery while preserving completed items."""
    # 1. Enforce course ownership at SQL level
    course = db.query(Course).filter(Course.id == course_id, Course.user_id == user_id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    # 2. Get existing items
    existing_items = (
        db.query(RoadmapItem)
        .filter(RoadmapItem.course_id == course_id, RoadmapItem.user_id == user_id)
        .order_by(RoadmapItem.day.asc())
        .all()
    )
    if not existing_items:
        # If no roadmap exists yet, generate initial roadmap
        return await generate_course_roadmap(
            course_id=course_id,
            user_id=user_id,
            db=db,
            gateway=gateway,
            overwrite=False,
        )

    # 3. Get course topics and updated masteries
    topics = db.query(Topic).filter(Topic.course_id == course_id).all()
    if not topics:
        return existing_items

    masteries = (
        db.query(Mastery)
        .filter(Mastery.course_id == course_id, Mastery.user_id == user_id)
        .all()
    )
    mastery_map = {m.topic_id: m.score for m in masteries}

    # 4. Run deterministic replan_roadmap
    topic_infos = [TopicInfo(id=t.id, name=t.name) for t in topics]
    recomputed_days = replan_roadmap(
        existing_items=existing_items,
        updated_mastery=mastery_map,
        goal_days=course.goal_days,
        hours_per_day=course.hours_per_day,
        level=course.level,
        topics=topic_infos,
    )

    # 5. Identify uncompleted days that were newly scheduled
    uncompleted_days = [d for d in recomputed_days if not d.completed]

    # Generate wording only for newly planned uncompleted days
    if uncompleted_days:
        wording_days = await _generate_wording_for_schedule(
            planned_days=uncompleted_days,
            course=course,
            gateway=gateway,
        )
        new_uncompleted_items = _apply_wording_to_plan(
            planned_days=uncompleted_days,
            wording_days=wording_days,
            course_id=course_id,
            user_id=user_id,
        )
    else:
        new_uncompleted_items = []

    # 6. Delete old uncompleted items from DB
    db.query(RoadmapItem).filter(
        RoadmapItem.course_id == course_id,
        RoadmapItem.user_id == user_id,
        RoadmapItem.completed.is_(False),
    ).delete()
    db.flush()

    # 7. Insert newly planned uncompleted items
    for item in new_uncompleted_items:
        db.add(item)
    db.commit()

    # 8. Return all items in order
    all_items = (
        db.query(RoadmapItem)
        .filter(RoadmapItem.course_id == course_id, RoadmapItem.user_id == user_id)
        .order_by(RoadmapItem.day.asc())
        .all()
    )
    return all_items
