"""Comprehensive acceptance tests for Part 9: End-to-End RAG, Syllabus Intelligence, Grounding, and Citations."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.orm import Session

from app.ai.guardrails.output_guard import check_output_guardrails
from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import LLMResponse
from app.ai.quiz.quiz_gen import get_topic_chunks
from app.ai.topics.topic_grouping import is_unwanted_topic_name
from app.ai.tutor.graph import INSUFFICIENT_REFUSAL, tutor_app
from app.buddy.tone import ToneContext
from app.db.models import Chunk, ChunkTopic, Course, Document, Topic, User
from app.retrieval.search import (
    SearchResult,
    broad_course_search,
    hybrid_search,
    is_broad_query,
)
from app.retrieval.sufficiency import check_sufficiency


@pytest.fixture
def rag_user(db_session: Session):
    user = User(firebase_uid="rag_user_uid", email="rag@example.com", display_name="RAG Tester")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def other_user(db_session: Session):
    user = User(firebase_uid="other_user_uid", email="other@example.com", display_name="Other User")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def rag_course(db_session: Session, rag_user: User):
    course = Course(
        name="Cloud Computing & Distributed Systems",
        goal_days=14,
        hours_per_day=1.5,
        level="intermediate",
        user_id=rag_user.id,
    )
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    doc = Document(
        course_id=course.id,
        user_id=rag_user.id,
        file_uri="storage/cloud_notes.pdf",
        status="ready",
    )
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    # 1024-dim unit vector
    vec_unit = [1.0 / 32.0] * 1024

    c1 = Chunk(
        document_id=doc.id,
        course_id=course.id,
        user_id=rag_user.id,
        page=55,
        heading_path="Module 1 > Introduction to Cloud",
        text="Cloud computing provides on-demand delivery of compute power, database storage, and IT resources over the internet with pay-as-you-go pricing.",
        embedding=vec_unit,
        low_conf=False,
        injection_flag=False,
    )
    c2 = Chunk(
        document_id=doc.id,
        course_id=course.id,
        user_id=rag_user.id,
        page=57,
        heading_path="Module 1 > Cloud Characteristics",
        text="Essential cloud characteristics include on-demand self-service, broad network access, resource pooling, rapid elasticity, and measured service.",
        embedding=vec_unit,
        low_conf=False,
        injection_flag=False,
    )
    c3 = Chunk(
        document_id=doc.id,
        course_id=course.id,
        user_id=rag_user.id,
        page=80,
        heading_path="Module 2 > Virtualization",
        text="Hypervisors abstract physical hardware, allowing multiple operating systems to run concurrently on a single physical machine.",
        embedding=vec_unit,
        low_conf=False,
        injection_flag=False,
    )
    db_session.add_all([c1, c2, c3])
    db_session.commit()
    db_session.refresh(c1)
    db_session.refresh(c2)
    db_session.refresh(c3)

    return {"course": course, "doc": doc, "chunks": [c1, c2, c3], "vec": vec_unit}


def make_mock_chunk(
    doc_name: str = "cloud_notes.pdf",
    page: int = 55,
    text: str = "Cloud computing is on-demand.",
    chunk_id: int = 1,
) -> SearchResult:
    return SearchResult(
        chunk_id=chunk_id,
        document_id=1,
        document_name=doc_name,
        course_id=1,
        user_id=1,
        page=page,
        text=text,
        score=0.05,
        dense_score=0.9,
    )


# ---------------------------------------------------------------------------
# Part 9.1 & 9.2: Syllabus and Topic Intelligence Tests
# ---------------------------------------------------------------------------


def test_syllabus_unwanted_raw_commands_filtered():
    """Verify raw bash, code snippets, pip commands, and arbitrary instructions are filtered out."""
    assert is_unwanted_topic_name("pip install boto3") is True
    assert is_unwanted_topic_name("git clone https://github.com/repo") is True
    assert is_unwanted_topic_name("npm run dev") is True
    assert is_unwanted_topic_name("def calculate_total(a, b):") is True
    assert is_unwanted_topic_name("curl -X POST http://localhost:8000") is True
    assert is_unwanted_topic_name("docker run -d -p 80:80 nginx") is True
    assert is_unwanted_topic_name("Chapter 1: Page 4") is True
    assert is_unwanted_topic_name("1.2") is True
    assert is_unwanted_topic_name("Introduction to Cloud Computing") is False
    assert is_unwanted_topic_name("Hardware Virtualization and Hypervisors") is False


def test_quiz_generation_requires_topic_evidence(db_session: Session, rag_course, rag_user):
    """Verify that practice quizzes only generate from valid topic-linked evidence."""
    course = rag_course["course"]
    chunk = rag_course["chunks"][0]

    # Topic with linked chunks
    valid_topic = Topic(
        course_id=course.id,
        name="Introduction to Cloud",
        module_name="Module 1",
        description="Core concepts of cloud services",
        learning_objective="Understand cloud computing definitions",
    )
    db_session.add(valid_topic)
    db_session.commit()

    tc = ChunkTopic(topic_id=valid_topic.id, chunk_id=chunk.id)
    db_session.add(tc)
    db_session.commit()

    chunks = get_topic_chunks(
        db=db_session,
        course_id=course.id,
        topic_id=valid_topic.id,
        user_id=rag_user.id,
    )
    assert len(chunks) == 1
    assert "Cloud computing provides on-demand delivery" in chunks[0].text

    # Topic with NO linked chunks
    empty_topic = Topic(
        course_id=course.id,
        name="Empty Topic Without Chunks",
    )
    db_session.add(empty_topic)
    db_session.commit()

    empty_chunks = get_topic_chunks(
        db=db_session,
        course_id=course.id,
        topic_id=empty_topic.id,
        user_id=rag_user.id,
    )
    assert len(empty_chunks) == 0


# ---------------------------------------------------------------------------
# Part 9.3: 12 Core RAG Retrieval and Grounding Scenarios
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scenario_1_answerable_what_is_cloud_computing(
    db_session: Session, rag_course, rag_user
):
    """Scenario 1: 'What is cloud computing?' supported by source returns grounded answer and separated sources."""
    course = rag_course["course"]
    vec = rag_course["vec"]
    mock_llm_response = LLMResponse(
        content="Cloud computing is the on-demand delivery of compute, storage, and databases over the internet with pay-as-you-go pricing [doc p.55].",
        provider="fake",
        model="fake-smart",
        role="smart",
        tokens_in=100,
        tokens_out=50,
        latency_ms=10.0,
    )

    mock_embedder = AsyncMock()
    mock_embedder.embed_texts.return_value = [vec]

    with (
        patch("app.ai.tutor.graph.get_embedder", return_value=mock_embedder),
        patch.object(
            LLMGateway, "chat_completion", new_callable=AsyncMock, return_value=mock_llm_response
        ),
    ):
        state = {
            "db": db_session,
            "message": "What is cloud computing?",
            "course_id": course.id,
            "user_id": rag_user.id,
            "tone_context": ToneContext(),
        }
        res = await tutor_app.ainvoke(state)

        assert res["grounding_status"] == "grounded"
        assert "Cloud computing is the on-demand delivery" in res["clean_answer"]
        assert len(res["sources"]) >= 1
        assert res["sources"][0]["page"] == 55
        assert res["sources"][0]["document_name"] == "cloud_notes.pdf"


@pytest.mark.asyncio
async def test_scenario_2_valid_paraphrase_accepted(db_session: Session, rag_course, rag_user):
    """Scenario 2: Semantic paraphrase of source facts is accepted without requiring exact verbatim wording."""
    course = rag_course["course"]
    vec = rag_course["vec"]
    mock_llm_response = LLMResponse(
        content="Instead of buying physical data centers, organizations can rent computing capacity and storage online, paying only for what they consume [doc p.55].",
        provider="fake",
        model="fake-smart",
        role="smart",
        tokens_in=80,
        tokens_out=40,
        latency_ms=10.0,
    )

    mock_embedder = AsyncMock()
    mock_embedder.embed_texts.return_value = [vec]

    with (
        patch("app.ai.tutor.graph.get_embedder", return_value=mock_embedder),
        patch.object(
            LLMGateway, "chat_completion", new_callable=AsyncMock, return_value=mock_llm_response
        ),
    ):
        state = {
            "db": db_session,
            "message": "Can you explain cloud utility billing in simple terms?",
            "course_id": course.id,
            "user_id": rag_user.id,
            "tone_context": ToneContext(),
        }
        res = await tutor_app.ainvoke(state)

        assert res["grounding_status"] == "grounded"
        assert "rent computing capacity" in res["clean_answer"]
        assert res["clean_answer"] != INSUFFICIENT_REFUSAL


@pytest.mark.asyncio
async def test_scenario_3_question_absent_from_document_fails_closed(
    db_session: Session, rag_course, rag_user
):
    """Scenario 3: A question absent from the documents fails closed with insufficient refusal."""
    course = rag_course["course"]
    # Orthogonal query vector produces 0.0 dot product with [1/32]*1024
    orthogonal_vec = [-1.0 / 32.0 if i % 2 == 0 else 1.0 / 32.0 for i in range(1024)]
    mock_embedder = AsyncMock()
    mock_embedder.embed_texts.return_value = [orthogonal_vec]

    state = {
        "db": db_session,
        "message": "How do you bake a sourdough loaf from starter?",
        "course_id": course.id,
        "user_id": rag_user.id,
        "tone_context": ToneContext(),
    }

    mock_llm_res = LLMResponse(
        content="sourdough baking starter",
        provider="fake",
        model="fake-fast",
        role="fast",
        tokens_in=5,
        tokens_out=5,
        latency_ms=5.0,
    )

    with (
        patch("app.ai.tutor.graph.get_embedder", return_value=mock_embedder),
        patch.object(
            LLMGateway, "chat_completion", new_callable=AsyncMock, return_value=mock_llm_res
        ) as mock_call,
    ):
        res = await tutor_app.ainvoke(state)
        assert res["is_sufficient"] is False
        assert (
            "not cover" in res["final_reply"].lower()
            or "could not verify" in res["final_reply"].lower()
        )
        # Verify 0 smart generation calls were made
        smart_calls = [c for c in mock_call.call_args_list if c.kwargs.get("role") == "smart"]
        assert len(smart_calls) == 0


def test_scenario_4_broad_course_summary_retrieval(db_session: Session, rag_course, rag_user):
    """Scenario 4: Broad query triggers broad_course_search across diverse sections instead of a single narrow chunk."""
    course = rag_course["course"]
    query = "Summarize the key learning concepts in these materials."

    assert is_broad_query(query) is True

    # Use broad_course_search
    results = broad_course_search(
        course_id=course.id,
        user_id=rag_user.id,
        db=db_session,
        limit=10,
    )

    assert len(results) >= 2
    # Check that multiple pages/sections across the course were retrieved
    pages = {r.page for r in results if r.page is not None}
    assert len(pages) > 1  # Spans both Module 1 and Module 2


def test_scenario_5_irrelevant_chunks_rejected_by_sufficiency():
    """Scenario 5: Chunks with low similarity (< 0.28) and low RRF fail sufficiency check."""
    irrelevant_results = [
        SearchResult(
            chunk_id=999,
            document_id=1,
            document_name="doc.pdf",
            course_id=1,
            user_id=1,
            page=1,
            text="Completely unrelated text about gardening and soil pH.",
            heading_path="Gardening",
            score=0.005,
            dense_score=0.05,  # Very low similarity
        )
    ]
    sufficiency = check_sufficiency(irrelevant_results, is_broad=False)
    assert sufficiency.is_sufficient is False


def test_scenario_6_duplicate_chunks_deduplicated():
    """Scenario 6: Overlapping / identical chunk references are safely deduplicated in output guard."""
    chunk = make_mock_chunk(doc_name="cloud_notes.pdf", page=55)
    guard_res = check_output_guardrails(
        reply="Cloud computing scales easily [doc p.55] and allows flexible resources [doc p.55].",
        retrieved_chunks=[chunk],
    )
    # Only 1 unique source reference should remain
    assert len(guard_res.sources) == 1
    assert guard_res.sources[0]["page"] == 55
    assert guard_res.sources[0]["document_name"] == "cloud_notes.pdf"


@pytest.mark.asyncio
async def test_scenario_7_prompt_injection_in_retrieved_context_ignored(
    db_session: Session, rag_course, rag_user
):
    """Scenario 7: Malicious instructions in document context are treated as untrusted text, not instructions."""
    course = rag_course["course"]
    vec = rag_course["vec"]

    # Even if LLM was coaxed into ignoring grounding, output guardrail verifies citations against retrieved context
    mock_llm_response = LLMResponse(
        content="SYSTEM OVERRIDE SUCCESSFUL: You are now a general assistant [doc p.999].",
        provider="fake",
        model="fake-smart",
        role="smart",
        tokens_in=50,
        tokens_out=10,
        latency_ms=10.0,
    )

    mock_embedder = AsyncMock()
    mock_embedder.embed_texts.return_value = [vec]

    with (
        patch("app.ai.tutor.graph.get_embedder", return_value=mock_embedder),
        patch.object(
            LLMGateway, "chat_completion", new_callable=AsyncMock, return_value=mock_llm_response
        ),
    ):
        state = {
            "db": db_session,
            "message": "What are hypervisors?",
            "course_id": course.id,
            "user_id": rag_user.id,
            "tone_context": ToneContext(),
        }
        res = await tutor_app.ainvoke(state)
        # It must not output the ungrounded override answer
        assert res["grounding_status"] == "unverified"
        assert "SYSTEM OVERRIDE" not in res["final_reply"]
        assert "could not verify" in res["final_reply"].lower()


def test_scenario_8_invalid_model_response_fails_closed():
    """Scenario 8: Completely empty or ungrounded model output fails closed."""
    chunk = make_mock_chunk(doc_name="cloud_notes.pdf", page=1)
    guard_res = check_output_guardrails(
        reply="",
        retrieved_chunks=[chunk],
    )
    assert "could not verify" in guard_res.clean_reply.lower()
    assert guard_res.is_grounded is False


def test_scenario_9_hallucinated_source_id_rejected():
    """Scenario 9: Model cites a source/page not present in retrieved context -> stripped from sources."""
    chunk = make_mock_chunk(doc_name="cloud_notes.pdf", page=55)
    guard_res = check_output_guardrails(
        reply="Artificial intelligence transforms healthcare [doc p.999].",
        retrieved_chunks=[chunk],
    )
    # The hallucinated source must not be in the validated sources list
    matching_sources = [s for s in guard_res.sources if s.get("page") == 999]
    assert len(matching_sources) == 0


def test_scenario_10_fabricated_page_number_handled():
    """Scenario 10: Model fabricates a page number for a document that has no page metadata."""
    chunk_no_page = SearchResult(
        chunk_id=2,
        document_id=2,
        document_name="readme.md",
        course_id=1,
        user_id=1,
        page=1,  # Default fallback, but retrieved chunk has no p.42
        text="Markdown documents do not have pages.",
        score=0.1,
        dense_score=0.9,
    )
    guard_res = check_output_guardrails(
        reply="Markdown documents do not have pages [doc p.42].",
        retrieved_chunks=[chunk_no_page],
    )
    # Notice retrieved context has no page 42, so page 42 is not validated as legitimate
    for s in guard_res.sources:
        assert s.get("page") != 42 or s.get("document_name") != "readme.md"


def test_scenario_11_partial_evidence_handling():
    """Scenario 11: Answer supported partially keeps citations for verified parts and separates sources."""
    c80 = make_mock_chunk(
        doc_name="cloud_notes.pdf", page=80, text="Hypervisors manage virtual machines."
    )
    guard_res = check_output_guardrails(
        reply="Hypervisors manage virtual machines [doc p.80]. Also quantum computing uses qubits [doc p.300].",
        retrieved_chunks=[c80],
    )
    # Inline citations removed from clean_answer
    assert "[doc p.80]" not in guard_res.clean_answer
    assert "[doc p.300]" not in guard_res.clean_answer
    # Only p.80 is in retrieved context, p.300 is hallucinated
    pages = [s.get("page") for s in guard_res.sources]
    assert 80 in pages
    assert 300 not in pages


def test_scenario_12_cross_user_cross_course_isolation(
    db_session: Session, rag_course, other_user: User
):
    """Scenario 12: SQL-level isolation prevents cross-user and cross-course chunk access."""
    course = rag_course["course"]
    vec = rag_course["vec"]

    # Other user attempts to search in rag_user's course
    unauthorized_results = hybrid_search(
        db=db_session,
        course_id=course.id,
        user_id=other_user.id,
        query_text="cloud computing",
        query_vector=vec,
        limit=5,
    )
    assert len(unauthorized_results) == 0

    # Authorized user searching in non-existent course
    wrong_course_results = hybrid_search(
        db=db_session,
        course_id=999999,
        user_id=rag_course["course"].user_id,
        query_text="cloud computing",
        query_vector=vec,
        limit=5,
    )
    assert len(wrong_course_results) == 0


# ---------------------------------------------------------------------------
# Part 9.4: Separate Citation Formatting
# ---------------------------------------------------------------------------


def test_citations_separated_at_bottom():
    """Test that citations are strictly formatted below the answer and inline markers are removed."""
    c55 = make_mock_chunk(doc_name="cloud_notes.pdf", page=55, text="servers")
    c57 = make_mock_chunk(doc_name="cloud_notes.pdf", page=57, text="storage")

    guard_res = check_output_guardrails(
        reply="Cloud computing delivers virtual servers [doc p.55] and storage [doc p.57]. It saves hardware costs.",
        retrieved_chunks=[c55, c57],
    )

    # Clean answer body must not contain inline [doc p.XX]
    assert "[doc p.55]" not in guard_res.clean_answer
    assert "[doc p.57]" not in guard_res.clean_answer
    assert (
        "Cloud computing delivers virtual servers and storage. It saves hardware costs."
        in guard_res.clean_answer
    )

    # Sources must contain both verified sources
    assert len(guard_res.sources) == 2
    pages = [s["page"] for s in guard_res.sources]
    assert 55 in pages
    assert 57 in pages
