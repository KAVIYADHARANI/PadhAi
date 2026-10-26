"""AI Flashcard generation agent for spaced repetition.

Follows BUILD_PLAYBOOK.md Phase 5 Task 5A:
- Generates flashcards from topic chunks or weak topics.
- One MODEL_SMART StructuredCall returning cards with Pydantic validation.
- Validates: non-empty front/back, front under length limit (<= 300 chars).
- Deduplicates against existing cards by normalized front text.
- Grounded in retrieved chunks with neutral language (no persona banter).
- Respects security rules:
  - Document text is wrapped in <study_material> delimiters.
  - Queries strictly filter by user_id and course_id.
  - No message text or document text in logs.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime

from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import ChatMessage, ModelRole
from app.ai.harness.structured import StructuredCall
from app.db.models import Chunk, ChunkTopic, Course, Flashcard, Mastery, Topic
from app.learning.weak_topics import weak_topics

logger = logging.getLogger(__name__)


def normalize_card_text(text: str) -> str:
    """Normalizes card prompt text for deduplication."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


class FlashcardItem(BaseModel):
    """Schema for a single generated flashcard."""

    front: str = Field(
        ...,
        min_length=3,
        max_length=300,
        description="Active recall prompt, question, or key concept (max 300 characters).",
    )
    back: str = Field(
        ...,
        min_length=3,
        max_length=2000,
        description="Concise, clear explanation, definition, or answer.",
    )
    source_chunk_ids: list[int] = Field(
        default_factory=list,
        description="IDs of source chunks used to verify and ground this card.",
    )

    @field_validator("front")
    @classmethod
    def validate_front_not_empty(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Flashcard front cannot be empty or whitespace only.")
        return cleaned

    @field_validator("back")
    @classmethod
    def validate_back_not_empty(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Flashcard back cannot be empty or whitespace only.")
        return cleaned


class FlashcardDeck(BaseModel):
    """Container for a generated flashcard deck."""

    cards: list[FlashcardItem] = Field(..., min_length=1)


def get_flashcard_topic_chunks(
    db: Session,
    course_id: int,
    topic_id: int | None,
    user_id: int,
    limit: int = 8,
) -> tuple[int | None, str, list[Chunk]]:
    """Retrieve grounded chunks associated with a topic or the course."""
    topic_name = "General Knowledge"

    if topic_id is not None:
        topic = (
            db.query(Topic)
            .filter(Topic.id == topic_id, Topic.course_id == course_id)
            .first()
        )
        if topic:
            topic_name = topic.name

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

        if not chunks:
            all_course_chunks = (
                db.query(Chunk)
                .filter(
                    Chunk.course_id == course_id,
                    Chunk.user_id == user_id,
                )
                .all()
            )
            if topic:
                topic_words = [w for w in topic.name.lower().split() if len(w) >= 3]
                chunks = [
                    c
                    for c in all_course_chunks
                    if any(w in (c.heading_path or "").lower() or w in c.text.lower() for w in topic_words)
                ][:limit]
            if not chunks:
                chunks = all_course_chunks[:limit]
    else:
        # Auto-pick weakest topic if available
        masteries = (
            db.query(Mastery)
            .filter(
                Mastery.course_id == course_id,
                Mastery.user_id == user_id,
            )
            .all()
        )
        mastery_map = {m.topic_id: m.score for m in masteries}
        ranked_weak = weak_topics(mastery_map)

        if ranked_weak:
            chosen_topic_id = ranked_weak[0]
            return get_flashcard_topic_chunks(db, course_id, chosen_topic_id, user_id, limit)

        # Fallback to first topic in course
        first_topic = db.query(Topic).filter(Topic.course_id == course_id).first()
        if first_topic:
            return get_flashcard_topic_chunks(db, course_id, first_topic.id, user_id, limit)

        # Fallback to course chunks
        chunks = (
            db.query(Chunk)
            .filter(
                Chunk.course_id == course_id,
                Chunk.user_id == user_id,
            )
            .limit(limit)
            .all()
        )

    return topic_id, topic_name, chunks


async def generate_flashcards_for_topic(
    db: Session,
    gateway: LLMGateway,
    course_id: int,
    user_id: int,
    topic_id: int | None = None,
    count: int = 5,
) -> list[Flashcard]:
    """Generates active recall flashcards, deduplicating against existing course cards."""
    # 1. Verify course ownership
    course = (
        db.query(Course)
        .filter(Course.id == course_id, Course.user_id == user_id)
        .first()
    )
    if not course:
        raise ValueError(f"Course {course_id} not found for user {user_id}")

    resolved_topic_id, topic_name, chunks = get_flashcard_topic_chunks(
        db, course_id, topic_id, user_id, limit=8
    )

    if not chunks:
        logger.warning(
            "No document chunks available for flashcard generation",
            extra={"course_id": course_id, "user_id": user_id, "topic_id": resolved_topic_id},
        )
        return []

    # 2. Fetch existing flashcards for deduplication
    existing_cards = (
        db.query(Flashcard)
        .filter(
            Flashcard.course_id == course_id,
            Flashcard.user_id == user_id,
        )
        .all()
    )
    existing_normalized_fronts = {normalize_card_text(card.front) for card in existing_cards}

    # 3. Format grounded chunks wrapped in strict security delimiters
    retrieved_chunk_ids = [c.id for c in chunks]
    formatted_chunks = []
    for c in chunks:
        header = f"[Chunk ID: {c.id} | Page: {c.page}]"
        if c.heading_path:
            header += f" (Section: {c.heading_path})"
        formatted_chunks.append(f"{header}\n{c.text.strip()}")

    chunks_context = "\n\n".join(formatted_chunks)

    system_prompt = (
        "You are an expert educational study companion. Your task is to generate high-yield active-recall "
        "flashcards grounded exclusively in the provided study material.\n\n"
        "Guidelines:\n"
        "1. Write clear, unambiguous questions or concept prompts on the front (maximum 300 characters).\n"
        "2. Write complete, direct, and concise explanations on the back (focus on core understanding, definitions, or mechanisms).\n"
        "3. Neutral academic tone: do NOT use slang, persona banter, or conversational filler.\n"
        "4. CITE: Each card must include the integer chunk ID(s) from which the fact was extracted in source_chunk_ids.\n"
        "5. ONLY generate cards verifiable from the provided study material. Never invent facts."
    )

    user_prompt = (
        f"Topic: {topic_name}\n"
        f"Desired count: {count} flashcards\n\n"
        "<study_material>\n"
        f"{chunks_context}\n"
        "</study_material>\n\n"
        "Generate a deck of active-recall flashcards based strictly on the material above."
    )

    messages = [
        ChatMessage(role="system", content=system_prompt),
        ChatMessage(role="user", content=user_prompt),
    ]

    structured_call = StructuredCall(gateway)
    deck: FlashcardDeck = await structured_call.execute(
        schema=FlashcardDeck,
        messages=messages,
        role=ModelRole.SMART,
        temperature=0.2,
        user_id=user_id,
        course_id=course_id,
        agent_name="flashcards",
    )

    # 4. Filter, deduplicate, and persist
    new_flashcards: list[Flashcard] = []
    now = datetime.now(UTC)

    for item in deck.cards:
        norm_front = normalize_card_text(item.front)
        if not norm_front or norm_front in existing_normalized_fronts:
            continue

        existing_normalized_fronts.add(norm_front)

        # Filter source chunk IDs to those actually retrieved
        valid_chunk_ids = [cid for cid in item.source_chunk_ids if cid in retrieved_chunk_ids]
        if not valid_chunk_ids and retrieved_chunk_ids:
            valid_chunk_ids = [retrieved_chunk_ids[0]]

        flashcard = Flashcard(
            user_id=user_id,
            course_id=course_id,
            topic_id=resolved_topic_id,
            front=item.front.strip(),
            back=item.back.strip(),
            source_chunk_ids=valid_chunk_ids,
            reps=0,
            interval_days=0,
            ease_factor=2.5,
            due_date=now,
            created_at=now,
            updated_at=now,
        )
        db.add(flashcard)
        new_flashcards.append(flashcard)

    if new_flashcards:
        db.commit()
        for card in new_flashcards:
            db.refresh(card)

    logger.info(
        "Generated flashcards for course",
        extra={
            "course_id": course_id,
            "user_id": user_id,
            "topic_id": resolved_topic_id,
            "status": "ready",
        },
    )

    return new_flashcards
