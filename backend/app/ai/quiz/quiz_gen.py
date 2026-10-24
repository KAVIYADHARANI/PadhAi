"""Quiz generation agent.

Follows BUILD_PLAYBOOK.md Phase 3 Task 3B:
- Given a topic, retrieves grounded chunks scoped strictly by (user_id, course_id).
- ONE MODEL_SMART StructuredCall returning questions with Pydantic validation:
  - answer must be one of the options.
  - explanation must be non-empty and reference >= 1 retrieved chunk ID.
  - no duplicate stems.
  - neutral language (zero persona banter).
- Retries with validation error on failure (max 2), then fails closed.
- Caches generated sets by (topic, chunk_hash) and saves to questions table.
"""

from __future__ import annotations

import hashlib
import logging

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai.harness.exceptions import StructuredOutputError
from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import ChatMessage, ModelRole
from app.ai.harness.structured import StructuredCall
from app.db.models import Chunk, ChunkTopic, Course, Question, Topic

logger = logging.getLogger(__name__)


class GeneratedQuestion(BaseModel):
    """Pydantic schema for a single generated question."""

    stem: str = Field(..., description="Neutral question stem testing student understanding.")
    options: list[str] = Field(..., min_length=2, max_length=6, description="Multiple-choice options.")
    answer: str = Field(..., description="The correct answer string, must be an exact match with one of the options.")
    explanation: str = Field(..., description="Clear explanation citing evidence from source chunk(s).")
    source_chunk_ids: list[int] = Field(..., min_length=1, description="IDs of source chunks used to ground this question.")
    difficulty: float = Field(default=1.0, ge=0.5, le=3.0, description="Difficulty weight (1.0 easy, 1.5 medium, 2.0 hard).")


class GeneratedQuiz(BaseModel):
    """Container for multiple generated quiz questions."""

    questions: list[GeneratedQuestion] = Field(..., min_length=1)


def get_topic_chunks(
    db: Session,
    course_id: int,
    topic_id: int,
    user_id: int,
    limit: int = 10,
) -> list[Chunk]:
    """Retrieve grounded chunks associated with a course topic for this user."""
    # 1. Primary: Chunks mapped via chunk_topics
    chunks = (
        db.query(Chunk)
        .join(ChunkTopic, Chunk.id == ChunkTopic.chunk_id)
        .filter(
            ChunkTopic.topic_id == topic_id,
            Chunk.course_id == course_id,
            Chunk.user_id == user_id,
        )
        .limit(limit)
        .all()
    )

    # 2. Fallback: If no topic mappings exist yet, retrieve course chunks
    if not chunks:
        chunks = (
            db.query(Chunk)
            .filter(
                Chunk.course_id == course_id,
                Chunk.user_id == user_id,
            )
            .limit(limit)
            .all()
        )

    return chunks


def compute_chunk_hash(chunks: list[Chunk]) -> str:
    """Compute a deterministic hash of the chunk texts and IDs."""
    content = "|".join(f"{c.id}:{c.text}" for c in sorted(chunks, key=lambda c: c.id))
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def validate_generated_quiz(
    quiz: GeneratedQuiz,
    valid_chunk_ids: set[int],
    existing_stems: set[str],
) -> list[str]:
    """Validate quiz questions against grounding, option membership, and uniqueness rules."""
    errors: list[str] = []
    seen_stems = set(existing_stems)

    for idx, q in enumerate(quiz.questions):
        prefix = f"Question {idx + 1}"

        # Rule 1: answer must be among options
        if q.answer not in q.options:
            errors.append(f"{prefix}: answer '{q.answer}' is not in options {q.options}")

        # Rule 2: explanation must be non-empty
        if not q.explanation.strip():
            errors.append(f"{prefix}: explanation cannot be empty.")

        # Rule 3: source_chunk_ids must refer to actually retrieved chunks
        invalid_ids = [cid for cid in q.source_chunk_ids if cid not in valid_chunk_ids]
        if invalid_ids:
            errors.append(
                f"{prefix}: source_chunk_ids {invalid_ids} are not among retrieved chunks {list(valid_chunk_ids)}"
            )

        # Rule 4: no duplicate stems
        normalized_stem = q.stem.strip().lower()
        if normalized_stem in seen_stems:
            errors.append(f"{prefix}: duplicate question stem '{q.stem}'")
        seen_stems.add(normalized_stem)

    return errors


async def generate_quiz(
    db: Session,
    gateway: LLMGateway,
    course_id: int,
    topic_id: int,
    user_id: int,
    count: int = 5,
    force_fresh: bool = False,
) -> list[Question]:
    """Generate or retrieve cached grounded quiz questions for a topic."""
    # Verify course ownership
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.user_id == user_id)
        .first()
    )
    if not course:
        raise ValueError(f"Course {course_id} not found or access denied.")

    # Verify topic exists in course
    topic = (
        db.query(Topic)
        .filter(Topic.id == topic_id, Topic.course_id == course_id)
        .first()
    )
    if not topic:
        raise ValueError(f"Topic {topic_id} not found in course {course_id}.")

    # Return existing cached questions if enough exist
    existing = (
        db.query(Question)
        .filter(Question.course_id == course_id, Question.topic_id == topic_id)
        .all()
    )
    if not force_fresh and len(existing) >= count:
        return existing[:count]

    # Retrieve source chunks
    chunks = get_topic_chunks(db, course_id, topic_id, user_id)
    if not chunks:
        raise ValueError("No study materials available to generate questions for this topic.")

    valid_chunk_ids = {c.id for c in chunks}
    existing_stems = {q.stem.strip().lower() for q in existing}
    needed_count = count - len(existing) if not force_fresh else count

    # Build context XML
    chunk_xmls: list[str] = []
    for c in chunks:
        untrusted_flag = ' untrusted="true"' if c.injection_flag else ""
        chunk_xmls.append(
            f'<chunk id="{c.id}" page="{c.page}"{untrusted_flag}>\n{c.text}\n</chunk>'
        )
    context_text = "\n".join(chunk_xmls)

    system_prompt = (
        "You are an academic assessment question generator. "
        "Generate high-quality multiple choice quiz questions strictly grounded in the provided course study chunks.\n\n"
        "RULES:\n"
        "1. GROUNDING: Answer and explanation must be fully justified by the text inside the <chunk> elements. "
        "Do not invent facts or extrapolate beyond what is stated.\n"
        "2. NEUTRAL TONE: Write in completely neutral academic language. No bot persona, no slang, no conversational chatter.\n"
        "3. FORMAT: Each question must have 4 plausible options.\n"
        "4. VALIDATION: 'answer' MUST match exactly one of the options in 'options'.\n"
        "5. CITATION: 'source_chunk_ids' must contain the exact chunk ID(s) grounding the question.\n"
        "6. UNIQUENESS: Do not repeat questions or question stems."
    )

    user_prompt = (
        f"Topic: {topic.name}\n"
        f"Required questions: {needed_count}\n\n"
        f"STUDY CHUNKS:\n{context_text}\n\n"
        f"Generate {needed_count} grounded questions matching the schema."
    )

    structured_caller = StructuredCall(gateway=gateway)
    messages = [
        ChatMessage(role="system", content=system_prompt),
        ChatMessage(role="user", content=user_prompt),
    ]

    # Loop with up to 2 domain-validation retries
    max_retries = 2
    saved_questions: list[Question] = list(existing) if not force_fresh else []

    for attempt in range(max_retries + 1):
        try:
            result = await structured_caller.execute(
                schema=GeneratedQuiz,
                messages=messages,
                role=ModelRole.SMART,
                temperature=0.2,
                user_id=user_id,
                course_id=course_id,
                agent_name="quiz_gen",
                max_retries=1,
            )
        except StructuredOutputError as e:
            logger.error("StructuredCall failed for quiz_gen: %s", e)
            if attempt >= max_retries:
                raise
            continue

        errors = validate_generated_quiz(result, valid_chunk_ids, existing_stems)
        if not errors:
            # All validation checks passed! Persist to DB
            for gq in result.questions:
                q_model = Question(
                    course_id=course_id,
                    topic_id=topic_id,
                    stem=gq.stem.strip(),
                    question_type="mcq",
                    options=gq.options,
                    answer=gq.answer.strip(),
                    explanation=gq.explanation.strip(),
                    source_chunk_ids=gq.source_chunk_ids,
                    difficulty=gq.difficulty,
                )
                db.add(q_model)
                saved_questions.append(q_model)

            db.commit()
            for q_model in saved_questions:
                db.refresh(q_model)
            return saved_questions[:count]

        # Validation failed on domain rules
        logger.warning(
            "Quiz domain validation failed on attempt %d: %s",
            attempt,
            errors,
        )
        if attempt < max_retries:
            messages.append(ChatMessage(role="assistant", content=result.model_dump_json()))
            messages.append(
                ChatMessage(
                    role="user",
                    content=(
                        "The quiz questions failed validation with these errors:\n"
                        + "\n".join(f"- {err}" for err in errors)
                        + "\nPlease fix these errors and regenerate strictly adhering to all rules."
                    ),
                )
            )
        else:
            raise StructuredOutputError(
                f"Quiz validation failed after {max_retries} retries: {'; '.join(errors)}"
            )

    return saved_questions[:count]
