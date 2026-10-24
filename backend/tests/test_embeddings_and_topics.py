"""Unit and integration tests for embeddings generation, dimension validation, and topic grouping (Task 1B)."""

import json
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.ai.embedding.embedder import DimensionMismatchError, FakeEmbedder
from app.ai.harness.cache import InMemoryCache
from app.ai.harness.fake import FakeLLM
from app.ai.harness.gateway import LLMGateway
from app.ai.topics.topic_grouping import group_chunks_into_topics
from app.db.models import Chunk, ChunkTopic, Course, Document, Topic, User
from app.worker.ingest_worker import process_document
from tests.test_ingestion import create_minimal_text_pdf

# ---------------------------------------------------------------------------
# 1. Embedder Tests (Dimension validation & Caching)
# ---------------------------------------------------------------------------


async def test_embedder_dimension_mismatch_fails_loudly():
    """Fails loudly with DimensionMismatchError when vector dimension != EMBED_DIM."""
    embedder = FakeEmbedder(dim=1024, force_dim=512)
    with pytest.raises(DimensionMismatchError) as exc_info:
        await embedder.embed_texts(["Calculus is the mathematical study of continuous change."])

    assert "dimension mismatch" in str(exc_info.value).lower()
    assert "1024" in str(exc_info.value)
    assert "512" in str(exc_info.value)


async def test_embedder_caching_avoids_duplicate_calls():
    """Identical texts hit cache and avoid redundant embedding generation calls."""
    cache = InMemoryCache()
    embedder = FakeEmbedder(dim=1024, cache=cache)

    sample_text = "The mitochondria is the powerhouse of the cell."
    vec1 = await embedder.embed_texts([sample_text])
    assert embedder.call_count == 1
    assert len(vec1[0]) == 1024

    # Second call with same text should hit cache
    vec2 = await embedder.embed_texts([sample_text])
    assert embedder.call_count == 1  # No additional API call made
    assert vec1[0] == vec2[0]


# ---------------------------------------------------------------------------
# 2. Topic Grouping Tests
# ---------------------------------------------------------------------------


async def test_topic_grouping_validates_coverage_and_persists(db_session: Session):
    """Groups chunks into topics and persists hierarchy and ChunkTopic associations."""
    user = User(firebase_uid="topic_user_1", email="topic1@example.com")
    db_session.add(user)
    db_session.commit()

    course = Course(user_id=user.id, name="Biology 101")
    db_session.add(course)
    db_session.commit()

    doc = Document(course_id=course.id, user_id=user.id, file_uri="test.pdf", status="processing")
    db_session.add(doc)
    db_session.commit()

    chunk0 = Chunk(
        document_id=doc.id,
        course_id=course.id,
        user_id=user.id,
        page=1,
        heading_path="Unit 1 > Cells",
        text="Cell structure and organelle functions.",
    )
    chunk1 = Chunk(
        document_id=doc.id,
        course_id=course.id,
        user_id=user.id,
        page=2,
        heading_path="Unit 1 > Genetics",
        text="DNA replication and gene expression.",
    )
    db_session.add_all([chunk0, chunk1])
    db_session.commit()

    # Script FakeLLM to return topics mapping both chunks (indices 0 and 1)
    fake_topics_json = json.dumps(
        {
            "topics": [
                {
                    "name": "Cell Biology",
                    "parent_name": None,
                    "chunk_indices": [0],
                },
                {
                    "name": "Molecular Genetics",
                    "parent_name": None,
                    "chunk_indices": [1],
                },
            ]
        }
    )

    fake_llm = FakeLLM(default_response=fake_topics_json)
    gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)

    topics = await group_chunks_into_topics(
        course_id=course.id,
        chunks=[chunk0, chunk1],
        gateway=gateway,
        db=db_session,
        course_name=course.name,
    )

    assert len(topics) == 2
    topic_names = {t.name for t in topics}
    assert "Cell Biology" in topic_names
    assert "Molecular Genetics" in topic_names

    # Check ChunkTopic associations in DB
    links = db_session.query(ChunkTopic).all()
    assert len(links) == 2
    linked_chunk_ids = {link.chunk_id for link in links}
    assert chunk0.id in linked_chunk_ids
    assert chunk1.id in linked_chunk_ids


async def test_topic_grouping_auto_recovers_missing_chunk_indices(db_session: Session):
    """Enforces invariant: any chunks omitted by LLM are assigned to a fallback topic."""
    user = User(firebase_uid="topic_user_2", email="topic2@example.com")
    db_session.add(user)
    db_session.commit()

    course = Course(user_id=user.id, name="Computer Networks")
    db_session.add(course)
    db_session.commit()

    doc = Document(course_id=course.id, user_id=user.id, file_uri="net.pdf", status="processing")
    db_session.add(doc)
    db_session.commit()

    c0 = Chunk(
        document_id=doc.id, course_id=course.id, user_id=user.id, page=1, text="OSI Model Layer 1"
    )
    c1 = Chunk(
        document_id=doc.id, course_id=course.id, user_id=user.id, page=2, text="OSI Model Layer 2"
    )
    c2 = Chunk(
        document_id=doc.id, course_id=course.id, user_id=user.id, page=3, text="Routing protocols"
    )
    db_session.add_all([c0, c1, c2])
    db_session.commit()

    # Script FakeLLM to only map chunks 0 and 1, completely omitting chunk 2!
    incomplete_topics_json = json.dumps(
        {
            "topics": [
                {
                    "name": "OSI Physical & Data Link",
                    "parent_name": None,
                    "chunk_indices": [0, 1],
                }
            ]
        }
    )

    fake_llm = FakeLLM(default_response=incomplete_topics_json)
    gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)

    topics = await group_chunks_into_topics(
        course_id=course.id,
        chunks=[c0, c1, c2],
        gateway=gateway,
        db=db_session,
    )
    assert len(topics) >= 1

    # Invariant check: All 3 chunks must be mapped in ChunkTopic
    links = db_session.query(ChunkTopic).all()
    mapped_chunks = {link.chunk_id for link in links}
    assert c0.id in mapped_chunks
    assert c1.id in mapped_chunks
    assert c2.id in mapped_chunks  # Successfully mapped to fallback topic!


# ---------------------------------------------------------------------------
# 3. Full Worker End-to-End Ingestion with Embeddings & Topics
# ---------------------------------------------------------------------------


async def test_full_worker_pipeline_saves_embeddings_and_topics(
    db_session: Session, tmp_path: Path
):
    """End-to-end: document becomes ready with chunks containing vectors and topics mapped."""
    user = User(firebase_uid="e2e_user", email="e2e@example.com")
    db_session.add(user)
    db_session.commit()

    course = Course(user_id=user.id, name="Algorithms")
    db_session.add(course)
    db_session.commit()

    pdf_text = (
        "# Sorting Algorithms\n\n"
        "Quicksort is an efficient divide-and-conquer sorting algorithm.\n\n"
        "# Graph Algorithms\n\n"
        "Dijkstra algorithm computes shortest paths in weighted graphs."
    )
    pdf_bytes = create_minimal_text_pdf(pdf_text)
    pdf_path = tmp_path / "algorithms.pdf"
    pdf_path.write_bytes(pdf_bytes)

    doc = Document(course_id=course.id, user_id=user.id, file_uri=str(pdf_path), status="queued")
    db_session.add(doc)
    db_session.commit()

    fake_embedder = FakeEmbedder(dim=1024)
    fake_topics_json = json.dumps(
        {
            "topics": [
                {
                    "name": "Divide and Conquer",
                    "parent_name": None,
                    "chunk_indices": [0],
                }
            ]
        }
    )
    fake_llm = FakeLLM(default_response=fake_topics_json)
    gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)

    processed_doc = await process_document(
        document_id=doc.id,
        db=db_session,
        embedder=fake_embedder,
        gateway=gateway,
    )

    assert processed_doc.status == "ready"
    assert processed_doc.error is None
    assert processed_doc.pages == 1

    # Verify chunks have embeddings
    chunks = db_session.query(Chunk).filter(Chunk.document_id == doc.id).all()
    assert len(chunks) >= 1
    for chunk in chunks:
        assert chunk.embedding is not None
        assert len(chunk.embedding) == 1024

    # Verify topics and chunk_topics exist
    course_topics = db_session.query(Topic).filter(Topic.course_id == course.id).all()
    assert len(course_topics) >= 1

    chunk_links = db_session.query(ChunkTopic).all()
    assert len(chunk_links) >= len(chunks)
