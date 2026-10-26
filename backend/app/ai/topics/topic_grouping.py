"""Topic extraction and chunk grouping module.

Follows README Section 6 & End-to-End Syllabus Quality Architecture:
- Groups headings and chunks into structured curriculum topics.
- Enforces concise, educational learning concepts (NO raw commands, code snippets, or procedural steps).
- Supports modules/units, short descriptions, and learning objectives.
- Uses Pydantic schema validation.
- Validates that EVERY chunk maps to at least one topic.
- Persists topics and chunk_topics rows in the database.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Sequence

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import ChatMessage, ModelRole
from app.ai.harness.structured import StructuredCall
from app.db.models import Chunk, ChunkTopic, Topic

logger = logging.getLogger(__name__)


def is_unwanted_topic_name(name: str) -> bool:
    """Checks if a proposed topic name is a raw command, code snippet, or invalid fragment."""
    name_clean = name.strip().lower()
    command_prefixes = (
        "pip ",
        "npm ",
        "yarn ",
        "git ",
        "cd ",
        "mkdir ",
        "python ",
        "python3 ",
        "docker ",
        "curl ",
        "wget ",
        "sudo ",
        "apt-get ",
        "cat ",
        "ls ",
        "touch ",
    )
    if any(name_clean.startswith(p) for p in command_prefixes):
        return True

    prohibited_substrings = (
        "pip install",
        "npm install",
        "apt-get install",
        "git clone",
        "run dev",
        "def ",
        "class ",
        "import ",
        "export ",
        "const ",
        "let ",
        "return ",
    )
    if any(tok in name_clean for tok in prohibited_substrings):
        return True

    if re.match(
        r"^(chapter|section|page|unit|module)\s*\d+(\s*[:\-–]\s*(page\s*)?\d+)?$", name_clean
    ):
        return True

    if re.match(r"^\d+(\.\d+)*$", name_clean):
        return True

    if len(name_clean) < 3 or len(name_clean) > 120:
        return True

    return False


def clean_chunk_preview(chunk_text: str, max_chars: int = 150) -> str:
    """Extracts a readable conceptual text preview from a chunk, skipping code and shell commands."""
    lines = chunk_text.splitlines()
    candidate_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith(("```", "#", "$", ">>>", "import ", "export ", "from ")):
            continue
        if is_unwanted_topic_name(stripped):
            continue
        candidate_lines.append(stripped)
        if len(" ".join(candidate_lines)) >= max_chars:
            break

    preview = " ".join(candidate_lines)[:max_chars].strip()
    return preview or chunk_text[:max_chars].strip()


class TopicSpec(BaseModel):
    """Specification of a syllabus topic and its mapped chunk indices."""

    name: str = Field(
        description="Clear, concise educational concept name. Must NOT be a shell command, file path, installation instruction, code snippet, or procedural step.",
    )
    module_name: str = Field(
        default="General Concepts",
        description="Module or unit name categorizing this topic (e.g. 'Module 1: Cloud Architecture Fundamentals')",
    )
    parent_name: str | None = Field(
        default=None,
        description="Optional name of parent topic for two-level hierarchy",
    )
    description: str | None = Field(
        default=None,
        description="1-2 sentence overview of what this concept covers",
    )
    learning_objective: str | None = Field(
        default=None,
        description="Key learning objective (e.g. 'Understand the shared responsibility model in cloud computing')",
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
    - StructuredCall with ModelRole.FAST.
    - Meaningful learning concepts only (commands, code snippets, and procedural text rejected/merged).
    - Every chunk maps to at least one topic.
    - Persists Topic (with module_name, description, learning_objective) and ChunkTopic rows.
    """
    if not chunks:
        return []

    # 1. Format chunk headers and previews for the prompt
    chunk_summaries: list[str] = []
    for i, chunk in enumerate(chunks):
        heading = chunk.heading_path or "General"
        preview = clean_chunk_preview(chunk.text, max_chars=120)
        chunk_summaries.append(f"Chunk {i} [Page {chunk.page}, Heading: {heading}]: {preview}")

    prompt_content = (
        f"Analyze these {len(chunks)} chunks from course '{course_name}'.\n"
        "Synthesize them into clear educational syllabus topics organized by modules.\n"
        "Every single chunk index (from 0 to {len(chunks) - 1}) MUST be included in the 'chunk_indices' "
        "of at least one topic.\n\n"
        "STUDY CHUNKS:\n" + "\n".join(chunk_summaries)
    )

    system_content = (
        "You are an expert curriculum designer and educator. Your goal is to synthesize raw textbook "
        "and course document chunks into a structured, high-quality syllabus.\n"
        "CRITICAL RULES:\n"
        "1. Concept Names Only: Topics must be meaningful, professional learning concepts "
        "(e.g., 'Relational Schema Design', 'Cloud Service Models', 'Virtualization Architecture').\n"
        "2. Prohibited Standalone Topics: NEVER use shell commands ('pip install', 'npm run', 'git clone'), "
        "file paths, procedural commands, code snippets ('def main():'), or arbitrary sentence fragments as topic names. "
        "Group practical steps and code examples under their parent theoretical concept.\n"
        "3. Group into Modules: Provide a concise 'module_name' (e.g. 'Module 1: Foundations', 'Module 2: Core Architecture').\n"
        "4. Learning Objectives: Provide an actionable 'learning_objective' for each topic.\n"
        "5. Deduplication: Merge redundant or overlapping chunks under the same topic concept.\n"
        "6. Every chunk index from 0 to N-1 must map to at least one topic."
    )

    chat_messages = [
        ChatMessage(role="system", content=system_content),
        ChatMessage(role="user", content=prompt_content),
    ]

    structured_call = StructuredCall(gateway=gateway)
    try:
        result = await structured_call.execute(
            schema=TopicGroupingResponse,
            messages=chat_messages,
            role=ModelRole.FAST,
            course_id=course_id,
            agent_name="topic_grouping",
        )
    except Exception as exc:
        logger.warning(
            "Structured topic extraction failed: %s. Using heuristic topic fallback.", exc
        )
        result = _build_fallback_topic_grouping(chunks)

    # 2. Strict validation and sanitization
    all_indices = set(range(len(chunks)))
    covered_indices: set[int] = set()
    cleaned_topics: list[TopicSpec] = []

    for topic_spec in result.topics:
        # Normalize and filter out invalid names
        raw_name = topic_spec.name.strip()
        # Strip markdown bold/bullets if present
        raw_name = re.sub(r"^[\*\-\#\d\.\s]+", "", raw_name).strip()
        raw_name = re.sub(r"[\*\_`]", "", raw_name).strip()

        if is_unwanted_topic_name(raw_name):
            # Attempt to derive a clean concept name from heading or fallback
            if topic_spec.chunk_indices:
                first_chunk = chunks[min(topic_spec.chunk_indices)]
                heading = first_chunk.heading_path or ""
                candidate_heading = heading.split(">")[-1].strip()
                if candidate_heading and not is_unwanted_topic_name(candidate_heading):
                    raw_name = candidate_heading
                else:
                    raw_name = "Core Principles"
            else:
                raw_name = "Core Principles"

        topic_spec.name = raw_name
        if not topic_spec.module_name or topic_spec.module_name.strip() == "":
            topic_spec.module_name = "Module 1: Core Concepts"

        valid_indices = [idx for idx in topic_spec.chunk_indices if 0 <= idx < len(chunks)]
        topic_spec.chunk_indices = valid_indices
        covered_indices.update(valid_indices)
        cleaned_topics.append(topic_spec)

    result.topics = cleaned_topics

    missing_indices = all_indices - covered_indices
    if missing_indices:
        logger.info(
            "Topic grouping LLM missed %d chunks: %s. Attaching to General Concepts.",
            len(missing_indices),
            missing_indices,
        )
        fallback_topic = TopicSpec(
            name="General Concepts",
            module_name="Foundations",
            parent_name=None,
            description="Fundamental principles and introductory definitions.",
            learning_objective="Understand foundational terminology and course context.",
            chunk_indices=sorted(missing_indices),
        )
        result.topics.append(fallback_topic)

    # 3. Persist Topics and ChunkTopics in DB
    created_topics: list[Topic] = []
    topic_map: dict[str, Topic] = {}

    # First pass: Create or update parent topics (where parent_name is None)
    for spec in result.topics:
        if not spec.parent_name and spec.name not in topic_map:
            existing = (
                db.query(Topic)
                .filter(Topic.course_id == course_id, Topic.name == spec.name)
                .first()
            )
            if not existing:
                existing = Topic(
                    course_id=course_id,
                    name=spec.name,
                    parent_id=None,
                    module_name=spec.module_name,
                    description=spec.description,
                    learning_objective=spec.learning_objective,
                )
                db.add(existing)
                db.flush()
            else:
                if spec.module_name:
                    existing.module_name = spec.module_name
                if spec.description:
                    existing.description = spec.description
                if spec.learning_objective:
                    existing.learning_objective = spec.learning_objective
            topic_map[spec.name] = existing
            created_topics.append(existing)

    # Second pass: Create or update subtopics with parent_id
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
                existing = Topic(
                    course_id=course_id,
                    name=spec.name,
                    parent_id=parent_id,
                    module_name=spec.module_name,
                    description=spec.description,
                    learning_objective=spec.learning_objective,
                )
                db.add(existing)
                db.flush()
            else:
                if parent_id and not existing.parent_id:
                    existing.parent_id = parent_id
                if spec.module_name:
                    existing.module_name = spec.module_name
                if spec.description:
                    existing.description = spec.description
                if spec.learning_objective:
                    existing.learning_objective = spec.learning_objective
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


def _build_fallback_topic_grouping(chunks: Sequence[Chunk]) -> TopicGroupingResponse:
    """Deterministic fallback grouping when LLM is unavailable or fails."""
    heading_to_indices: dict[str, list[int]] = {}

    for i, c in enumerate(chunks):
        heading = (c.heading_path or "General Concepts").split(">")[-1].strip()
        if is_unwanted_topic_name(heading):
            heading = "General Concepts"
        if not heading:
            heading = "General Concepts"
        heading_to_indices.setdefault(heading, []).append(i)

    specs: list[TopicSpec] = []
    for heading, indices in heading_to_indices.items():
        specs.append(
            TopicSpec(
                name=heading,
                module_name="Module 1: Course Overview",
                parent_name=None,
                description=f"Core concepts and principles related to {heading}.",
                learning_objective=f"Master key fundamentals and applications of {heading}.",
                chunk_indices=indices,
            )
        )

    if not specs:
        specs.append(
            TopicSpec(
                name="General Concepts",
                module_name="Module 1: Foundations",
                parent_name=None,
                description="Core concepts and principles.",
                learning_objective="Master key fundamentals.",
                chunk_indices=list(range(len(chunks))),
            )
        )

    return TopicGroupingResponse(topics=specs)
