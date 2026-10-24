"""Topic extraction and chunk grouping module.

Follows README Section 6 & Phase 1 Task 1B:
- Groups headings and chunks into topics with ONE MODEL_FAST StructuredCall.
- Uses Pydantic schema validation.
- Validates that EVERY chunk maps to at least one topic.
- Persists topics and chunk_topics rows in the database.
"""

import logging
from collections.abc import Sequence

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import ChatMessage, ModelRole
from app.ai.harness.structured import StructuredCall
from app.db.models import Chunk, ChunkTopic, Topic

logger = logging.getLogger(__name__)


class TopicSpec(BaseModel):
    """Specification of a syllabus topic and its mapped chunk indices."""

    name: str = Field(description="Short descriptive name of the topic")
    parent_name: str | None = Field(
        default=None,
        description="Optional name of parent topic for two-level hierarchy",
    )
    chunk_indices: list[int] = Field(
        default_factory=list,
        description="0-based indices of chunks that belong to this topic",
    )


class TopicGroupingResponse(BaseModel):
    """Structured response grouping document chunks into topics."""

    topics: list[TopicSpec] = Field(
        description="List of educational topics covering all document chunks",
    )


async def group_chunks_into_topics(
    course_id: int,
    chunks: Sequence[Chunk],
    gateway: LLMGateway,
    db: Session,
    course_name: str = "Course Material",
) -> list[Topic]:
    """Extracts topics from chunks and associates them in the database.

    Guarantees:
    - Exactly one MODEL_FAST StructuredCall.
    - Every chunk maps to at least one topic (auto-fallback if LLM misses any).
    - Persists Topic and ChunkTopic rows.
    """
    if not chunks:
        return []

    # 1. Format chunk headers and previews for the prompt
    chunk_summaries: list[str] = []
    for i, chunk in enumerate(chunks):
        heading = chunk.heading_path or "General"
        # Take short first line or first 120 chars
        snippet = chunk.text.split("\n")[0][:120].strip()
        chunk_summaries.append(f"Chunk {i} [Page {chunk.page}, Heading: {heading}]: {snippet}")

    prompt_content = (
        f"Analyze these {len(chunks)} chunks from course '{course_name}'. "
        "Group them into high-level educational topics and subtopics. "
        "Every single chunk index (from 0 to {len(chunks) - 1}) MUST be included in the 'chunk_indices' "
        "of at least one topic.\n\n"
        + "\n".join(chunk_summaries)
    )

    chat_messages = [
        ChatMessage(
            role="system",
            content=(
                "You are an expert curriculum organizer. Create a concise topic hierarchy "
                "for the provided study chunks. Ensure all chunk indices are mapped to appropriate topics."
            ),
        ),
        ChatMessage(role="user", content=prompt_content),
    ]

    structured_call = StructuredCall(gateway=gateway)
    result = await structured_call.execute(
        schema=TopicGroupingResponse,
        messages=chat_messages,
        role=ModelRole.FAST,
        course_id=course_id,
        agent_name="topic_grouping",
    )

    # 2. Strict validation: Ensure every chunk index is accounted for
    all_indices = set(range(len(chunks)))
    covered_indices: set[int] = set()
    for topic_spec in result.topics:
        # Filter out invalid out-of-range indices
        valid_indices = [idx for idx in topic_spec.chunk_indices if 0 <= idx < len(chunks)]
        topic_spec.chunk_indices = valid_indices
        covered_indices.update(valid_indices)

    missing_indices = all_indices - covered_indices
    if missing_indices:
        logger.warning(
            "Topic grouping LLM missed %d chunks: %s. Attaching to fallback topic.",
            len(missing_indices),
            missing_indices,
        )
        # Ensure invariant: every chunk maps to at least one topic
        fallback_topic = TopicSpec(
            name="General Concepts",
            parent_name=None,
            chunk_indices=sorted(missing_indices),
        )
        result.topics.append(fallback_topic)

    # 3. Persist Topics and ChunkTopics in DB
    created_topics: list[Topic] = []
    topic_map: dict[str, Topic] = {}

    # First pass: Create parent topics (where parent_name is None)
    for spec in result.topics:
        if not spec.parent_name and spec.name not in topic_map:
            # Check if topic already exists in course
            existing = (
                db.query(Topic)
                .filter(Topic.course_id == course_id, Topic.name == spec.name)
                .first()
            )
            if not existing:
                existing = Topic(course_id=course_id, name=spec.name, parent_id=None)
                db.add(existing)
                db.flush()
            topic_map[spec.name] = existing
            created_topics.append(existing)

    # Second pass: Create subtopics with parent_id
    for spec in result.topics:
        if spec.parent_name:
            parent_topic = topic_map.get(spec.parent_name)
            parent_id = parent_topic.id if parent_topic else None
            existing = (
                db.query(Topic)
                .filter(Topic.course_id == course_id, Topic.name == spec.name)
                .first()
            )
            if not existing:
                existing = Topic(course_id=course_id, name=spec.name, parent_id=parent_id)
                db.add(existing)
                db.flush()
            topic_map[spec.name] = existing
            created_topics.append(existing)

    # Third pass: Associate chunks via ChunkTopic
    for spec in result.topics:
        topic_obj = topic_map.get(spec.name)
        if not topic_obj:
            continue
        for idx in spec.chunk_indices:
            chunk_id = chunks[idx].id
            existing_link = (
                db.query(ChunkTopic)
                .filter(ChunkTopic.chunk_id == chunk_id, ChunkTopic.topic_id == topic_obj.id)
                .first()
            )
            if not existing_link:
                link = ChunkTopic(chunk_id=chunk_id, topic_id=topic_obj.id)
                db.add(link)

    db.flush()
    return created_topics
