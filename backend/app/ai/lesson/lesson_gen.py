"""Lesson Generation Agent.

Generates complete, structured, interactive lessons for roadmap tasks:
1. Structured study notes with step-by-step explanations, terminology, and misconceptions.
2. Grounded strictly in uploaded course materials, citing [doc p.N].
3. Discovers real web resources and genuine YouTube tutorials.
4. Generates subject-appropriate worked examples and practical exercises with progressive hints.
5. Generates knowledge check self-questions.
6. Persists Lesson in database with idempotent updates.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import ChatMessage
from app.ai.harness.structured import StructuredCall
from app.ai.quiz.quiz_gen import get_topic_chunks
from app.ai.research.web_search import get_web_search_provider
from app.ai.research.youtube import get_youtube_provider
from app.core.config import settings
from app.db.models import Chunk, Course, Lesson, LessonProgress, RoadmapItem

logger = logging.getLogger(__name__)


class LessonSectionSpec(BaseModel):
    """Individual structured section of study notes."""

    id: str = Field(..., description="Unique section id, e.g. 'sec_1'")
    title: str = Field(..., description="Section heading")
    content: str = Field(..., description="Rich study notes explaining concepts step-by-step")
    key_concepts: list[str] = Field(default_factory=list, description="Key concepts introduced")
    code_snippet: str | None = Field(default=None, description="Optional code or formula snippet")
    source_citations: list[str] = Field(
        default_factory=list, description="Citations from course materials, e.g. [doc p.3]"
    )


class TermDefinitionSpec(BaseModel):
    """Key terminology definition."""

    term: str = Field(..., description="Technical term or keyword")
    definition: str = Field(..., description="Clear, precise definition")


class WorkedExampleSpec(BaseModel):
    """Step-by-step worked problem with explanation."""

    problem: str = Field(..., description="Real-world scenario or problem statement")
    step_by_step_solution: list[str] = Field(..., description="Ordered steps resolving the problem")
    explanation: str = Field(..., description="Pedagogical explanation of why this solution works")


class MisconceptionSpec(BaseModel):
    """Common misconception and its correction."""

    misconception: str = Field(..., description="Frequent incorrect belief or mistake")
    correction: str = Field(..., description="Correct understanding")
    explanation: str = Field(..., description="Detailed explanation of the difference")


class LessonExerciseSpec(BaseModel):
    """Practical exercise with progressive hints."""

    id: str = Field(..., description="Unique exercise id, e.g. 'ex_1'")
    prompt: str = Field(..., description="Exercise description or challenge")
    exercise_type: str = Field(
        default="conceptual", description="conceptual | code | numerical | scenario"
    )
    difficulty: str = Field(default="medium", description="easy | medium | hard")
    hints: list[str] = Field(..., min_length=1, description="Progressive hints (Hint 1, Hint 2)")
    solution: str = Field(..., description="Complete solution or sample answer")
    explanation: str = Field(..., description="Why this solution is correct")


class SelfCheckQuestionSpec(BaseModel):
    """Short self-check question for knowledge check."""

    id: str = Field(..., description="Question identifier, e.g. 'q_1'")
    question: str = Field(..., description="Concept check question")
    options: list[str] = Field(..., min_length=2, max_length=5, description="Multiple choice options")
    answer: str = Field(..., description="Correct option string")
    explanation: str = Field(..., description="Detailed explanation of correct answer")


class StructuredLessonContent(BaseModel):
    """Schema for complete structured study notes and interactive exercises."""

    title: str = Field(..., description="Lesson title")
    introduction: str = Field(..., description="Intuitive overview and real-world motivation")
    prerequisites: list[str] = Field(
        default_factory=list, description="Assumed prior knowledge or prerequisites"
    )
    sections: list[LessonSectionSpec] = Field(
        ..., min_length=2, description="Step-by-step explanatory sections"
    )
    key_terms: list[TermDefinitionSpec] = Field(
        ..., min_length=2, description="Key terminology and definitions"
    )
    worked_examples: list[WorkedExampleSpec] = Field(
        ..., min_length=1, description="Worked examples with step-by-step explanations"
    )
    misconceptions: list[MisconceptionSpec] = Field(
        ..., min_length=1, description="Common pitfalls and misconceptions"
    )
    summary: str = Field(..., description="Concise review summary")
    takeaways: list[str] = Field(..., min_length=2, description="Key takeaways")
    exercises: list[LessonExerciseSpec] = Field(
        ..., min_length=1, description="Practical practice exercises"
    )
    self_check_questions: list[SelfCheckQuestionSpec] = Field(
        ..., min_length=2, description="Interactive quiz knowledge checks"
    )
    deeper_learning: list[str] = Field(
        default_factory=list, description="Further exploration pointers or advanced questions"
    )


async def generate_lesson_for_task(
    course_id: int,
    roadmap_item_id: int,
    task_id: str,
    user_id: int,
    db: Session,
    gateway: LLMGateway | None = None,
    overwrite: bool = False,
) -> Lesson:
    """Generates, enriches with research, and persists an interactive lesson for a roadmap task."""
    # 1. SQL-level ownership verification
    course = (
        db.query(Course).filter(Course.id == course_id, Course.user_id == user_id).first()
    )
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )

    roadmap_item = (
        db.query(RoadmapItem)
        .filter(
            RoadmapItem.id == roadmap_item_id,
            RoadmapItem.course_id == course_id,
            RoadmapItem.user_id == user_id,
        )
        .first()
    )
    if not roadmap_item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Roadmap milestone not found",
        )

    # 2. Match task in roadmap item
    task_spec = None
    for t in roadmap_item.tasks or []:
        if t.get("id") == task_id:
            task_spec = t
            break

    task_desc = task_spec.get("task", roadmap_item.title) if task_spec else roadmap_item.title
    task_est_mins = task_spec.get("estimated_minutes", 30) if task_spec else 30

    # 3. Check existing lesson
    existing_lesson = (
        db.query(Lesson)
        .filter(
            Lesson.course_id == course_id,
            Lesson.roadmap_item_id == roadmap_item_id,
            Lesson.task_id == task_id,
            Lesson.user_id == user_id,
        )
        .first()
    )
    if existing_lesson and not overwrite:
        logger.info(
            "Returning existing lesson %d for course %d task %s",
            existing_lesson.id,
            course_id,
            task_id,
        )
        return existing_lesson

    # 4. Retrieve course material chunks
    topic_id = roadmap_item.topic_id
    topic_name = roadmap_item.topic_name
    objectives = roadmap_item.learning_objectives or [task_desc]

    chunks: list[Chunk] = []
    if topic_id:
        chunks = get_topic_chunks(db=db, course_id=course_id, topic_id=topic_id, user_id=user_id, limit=8)

    if not chunks:
        # Fallback to broad query or headings
        chunks = (
            db.query(Chunk)
            .filter(Chunk.course_id == course_id, Chunk.user_id == user_id)
            .limit(6)
            .all()
        )

    # Format chunks with untrusted data delimiters and build provenance records
    sources_metadata: list[dict[str, Any]] = []
    chunk_text_blocks: list[str] = ["<study_material>"]
    for c in chunks:
        doc_name = c.document.filename if c.document else "Course Document"
        citation_tag = f"[{doc_name} p.{c.page}]"
        chunk_text_blocks.append(
            f'<document_chunk id="{c.id}" source="{doc_name}" page="{c.page}" heading="{c.heading_path or ""}">'
            f"\n{c.text}\n"
            f"</document_chunk>"
        )
        sources_metadata.append(
            {
                "document_id": c.document_id,
                "document_name": doc_name,
                "page": c.page,
                "chunk_id": c.id,
                "heading": c.heading_path,
                "citation": citation_tag,
            }
        )
    chunk_text_blocks.append("</study_material>")
    context_material = "\n".join(chunk_text_blocks)

    # 5. Discover verified web resources & YouTube tutorials
    web_provider = get_web_search_provider()
    yt_provider = get_youtube_provider()

    web_resources = await web_provider.search(
        query=task_desc,
        topic=topic_name,
        objectives=objectives,
        limit=3,
    )
    youtube_resources = await yt_provider.discover_tutorials(
        topic=topic_name,
        learning_objectives=objectives,
        limit=3,
    )

    # 6. Generate structured lesson content with LLMGateway StructuredCall
    llm = gateway or LLMGateway()

    system_prompt = (
        f"You are an exceptional educator and instructional designer for {settings.PRODUCT_NAME}. "
        "Create a comprehensive, engaging, and clear interactive study lesson for the specified task.\n\n"
        "Grounding Rules:\n"
        "1. Prioritize the student's uploaded course materials below. Citing evidence using '[doc p.N]' is mandatory.\n"
        "2. Do not invent false claims about documents. If explaining beyond the documents, label it clearly.\n"
        "3. Provide step-by-step explanations, key definitions, real-world worked examples, common misconceptions, "
        "and practical exercises with progressive hints.\n"
        "4. Tailor depth to the learner level: "
        f"{course.level} (target duration: ~{task_est_mins} minutes).\n"
        "5. Return strictly the validated JSON adhering to StructuredLessonContent."
    )

    user_prompt = (
        f"{context_material}\n\n"
        f"Course: {course.name} ({course.level} level)\n"
        f"Topic: {topic_name}\n"
        f"Roadmap Milestone: Day {roadmap_item.day} - {roadmap_item.title}\n"
        f"Study Task: {task_desc}\n"
        f"Target Duration: {task_est_mins} minutes\n"
        f"Learning Objectives:\n" + "\n".join(f"- {o}" for o in objectives) + "\n\n"
        "Produce the full structured study lesson now."
    )

    structured_call = StructuredCall(gateway=llm)
    generated_content: StructuredLessonContent = await structured_call.execute(
        schema=StructuredLessonContent,
        messages=[
            ChatMessage(role="system", content=system_prompt),
            ChatMessage(role="user", content=user_prompt),
        ],
        role="smart",
        temperature=0.3,
        user_id=user_id,
        course_id=course_id,
    )

    content_dict = generated_content.model_dump()
    web_dict = [r.model_dump() for r in web_resources]
    yt_dict = [y.model_dump() for y in youtube_resources]
    exercises_dict = [ex.model_dump() for ex in generated_content.exercises]

    # 7. Persist Lesson in database
    if existing_lesson:
        existing_lesson.title = generated_content.title
        existing_lesson.estimated_minutes = task_est_mins
        existing_lesson.content = content_dict
        existing_lesson.web_resources = web_dict
        existing_lesson.youtube_resources = yt_dict
        existing_lesson.exercises = exercises_dict
        existing_lesson.sources = sources_metadata
        existing_lesson.status = "ready"
        db.commit()
        db.refresh(existing_lesson)
        lesson_record = existing_lesson
    else:
        lesson_record = Lesson(
            course_id=course_id,
            roadmap_item_id=roadmap_item_id,
            task_id=task_id,
            topic_id=topic_id,
            user_id=user_id,
            title=generated_content.title,
            estimated_minutes=task_est_mins,
            content=content_dict,
            web_resources=web_dict,
            youtube_resources=yt_dict,
            exercises=exercises_dict,
            sources=sources_metadata,
            status="ready",
        )
        db.add(lesson_record)
        db.commit()
        db.refresh(lesson_record)

    # 8. Ensure initial LessonProgress exists
    progress_record = (
        db.query(LessonProgress)
        .filter(LessonProgress.lesson_id == lesson_record.id, LessonProgress.user_id == user_id)
        .first()
    )
    if not progress_record:
        progress_record = LessonProgress(
            lesson_id=lesson_record.id,
            user_id=user_id,
            course_id=course_id,
            sections_completed=[],
            exercises_completed={},
            completed=False,
            time_spent_seconds=0,
        )
        db.add(progress_record)
        db.commit()

    return lesson_record
