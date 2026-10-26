"""Tests for the tutor LangGraph pipeline and guardrails."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.ai.guardrails.input_guard import DISTRESS_SUPPORT_REPLY
from app.ai.guardrails.output_guard import SAFE_VERIFY_FALLBACK
from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import LLMResponse
from app.ai.tutor.graph import INSUFFICIENT_REFUSAL, tutor_app
from app.buddy.tone import ToneContext
from app.db.models import Chunk, Course, Document, GuardrailEvent, User


@pytest.fixture
def test_user(db_session):
    user = User(firebase_uid="firebase_uid_1", email="user1@example.com", display_name="User One")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def seeded_course(db_session, test_user):
    course = Course(
        name="Computer Architecture",
        goal_days=30,
        hours_per_day=2.0,
        level="intermediate",
        user_id=test_user.id,
    )
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    doc = Document(
        course_id=course.id,
        user_id=test_user.id,
        file_uri="storage/test_doc.pdf",
        status="ready",
    )
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    # Seed chunk with keyword and dense-friendly text
    chunk = Chunk(
        document_id=doc.id,
        course_id=course.id,
        user_id=test_user.id,
        page=3,
        heading_path="Chapter 1 > ISA",
        text="The Instruction Set Architecture (ISA) defines the supported operations and registers of a processor.",
        low_conf=False,
        injection_flag=False,
    )
    db_session.add(chunk)
    db_session.commit()
    db_session.refresh(chunk)

    return course


@pytest.mark.asyncio
async def test_tutor_answerable_query(db_session, test_user, seeded_course):
    """Answerable query retrieves chunk, generates grounded answer with citation."""
    mock_llm_res = LLMResponse(
        content="The ISA defines the operations and registers of a processor [doc p.3].",
        provider="fake",
        model="fake-smart",
        role="smart",
        tokens_in=10,
        tokens_out=15,
        latency_ms=10.0,
    )

    with patch.object(LLMGateway, "chat_completion", new_callable=AsyncMock) as mock_call:
        mock_call.return_value = mock_llm_res

        state = {
            "db": db_session,
            "user_id": test_user.id,
            "course_id": seeded_course.id,
            "message": "What does ISA define?",
            "tone_context": ToneContext(),
        }

        result = await tutor_app.ainvoke(state)

        assert result["is_sufficient"] is True
        assert "[doc p.3]" in result["citations"]
        assert "processor" in result["final_reply"]
        assert "[doc p.3]" in result["final_reply"]
        mock_call.assert_called_once()


@pytest.mark.asyncio
async def test_tutor_unanswerable_refusal_makes_zero_smart_calls(
    db_session, test_user, seeded_course
):
    """Unanswerable query fails sufficiency gate and refuses without smart generation call."""
    state = {
        "db": db_session,
        "user_id": test_user.id,
        "course_id": seeded_course.id,
        "message": "Quantum teleportation recipe for alien chocolate",
        "tone_context": ToneContext(),
    }

    with patch.object(LLMGateway, "chat_completion", new_callable=AsyncMock) as mock_call:
        mock_call.return_value = LLMResponse(
            content="quantum chocolate",
            provider="fake",
            model="fake-fast",
            role="fast",
            tokens_in=5,
            tokens_out=5,
            latency_ms=5.0,
        )
        result = await tutor_app.ainvoke(state)

        assert result["is_sufficient"] is False
        assert result["final_reply"] == INSUFFICIENT_REFUSAL
        assert result["citations"] == []

        # Zero calls to role='smart' made
        smart_calls = [c for c in mock_call.call_args_list if c.kwargs.get("role") == "smart"]
        assert len(smart_calls) == 0


@pytest.mark.asyncio
async def test_tutor_hallucinated_citation_triggers_safe_fallback(
    db_session, test_user, seeded_course
):
    """If model cites a page not in the retrieved chunks, guard_out falls back safely."""
    # Model cites page 999 which does not exist in retrieved chunks
    mock_llm_res = LLMResponse(
        content="This is a hallucinated statement [doc p.999].",
        provider="fake",
        model="fake-smart",
        role="smart",
        tokens_in=10,
        tokens_out=15,
        latency_ms=10.0,
    )

    with patch.object(LLMGateway, "chat_completion", new_callable=AsyncMock) as mock_call:
        mock_call.return_value = mock_llm_res

        state = {
            "db": db_session,
            "user_id": test_user.id,
            "course_id": seeded_course.id,
            "message": "What does ISA define?",
            "tone_context": ToneContext(),
        }

        result = await tutor_app.ainvoke(state)

        assert result["final_reply"] == SAFE_VERIFY_FALLBACK
        assert result["citations"] == []


@pytest.mark.asyncio
async def test_tutor_link_exfiltration_stripped(db_session, test_user, seeded_course):
    """Model output with markdown links or raw URLs has links stripped."""
    mock_llm_res = LLMResponse(
        content="Refer to [Architecture Guide](https://evil.com/exfiltrate) for details [doc p.3].",
        provider="fake",
        model="fake-smart",
        role="smart",
        tokens_in=10,
        tokens_out=15,
        latency_ms=10.0,
    )

    with patch.object(LLMGateway, "chat_completion", new_callable=AsyncMock) as mock_call:
        mock_call.return_value = mock_llm_res

        state = {
            "db": db_session,
            "user_id": test_user.id,
            "course_id": seeded_course.id,
            "message": "What does ISA define?",
            "tone_context": ToneContext(),
        }

        result = await tutor_app.ainvoke(state)

        assert "https://evil.com" not in result["final_reply"]
        assert "Architecture Guide" in result["final_reply"]
        assert "[doc p.3]" in result["citations"]


@pytest.mark.asyncio
async def test_tutor_distress_routed_to_support_without_llm(db_session, test_user, seeded_course):
    """Distress input is intercepted by guard_in and returns support without invoking LLM."""
    with patch.object(LLMGateway, "chat_completion", new_callable=AsyncMock) as mock_call:
        state = {
            "db": db_session,
            "user_id": test_user.id,
            "course_id": seeded_course.id,
            "message": "I feel hopeless and I want to end my life",
            "tone_context": ToneContext(),
        }

        result = await tutor_app.ainvoke(state)

        assert result["final_reply"] == DISTRESS_SUPPORT_REPLY
        assert result["is_blocked"] is True
        mock_call.assert_not_called()


def test_guardrail_events_logged_without_text(db_session, test_user, seeded_course):
    """Verify that guardrail events in DB contain only layer, rule, action and NO text."""
    events = db_session.query(GuardrailEvent).filter(GuardrailEvent.user_id == test_user.id).all()
    for ev in events:
        assert ev.layer in ("input", "wellbeing", "retrieval", "output")
        assert ev.rule
        assert ev.action
        # Ensure no message content attribute exists on the model
        assert not hasattr(ev, "message_text")
        assert not hasattr(ev, "document_text")


def test_chat_endpoint_course_isolation(
    client: TestClient, db_session, test_user, auth_headers_user1
):
    """A user cannot access or chat with another user's course."""
    other_user = User(firebase_uid="uid_other_user", email="other@test.com")
    db_session.add(other_user)
    db_session.commit()

    other_course = Course(
        name="Other's Course",
        goal_days=10,
        hours_per_day=1.0,
        level="beginner",
        user_id=other_user.id,
    )
    db_session.add(other_course)
    db_session.commit()

    # Request to other_course by test_user should return 404
    resp = client.post(
        f"/api/courses/{other_course.id}/chat",
        json={"message": "Hello tutor"},
        headers=auth_headers_user1,
    )
    assert resp.status_code == 404
    assert "Course not found" in resp.json()["detail"]


def test_rag_tutor_sources_section_formatting():
    """Verify check_output_guardrails appends a separate Sources section at the end."""
    from app.ai.guardrails.output_guard import check_output_guardrails
    from app.retrieval.search import SearchResult

    mock_chunks = [
        SearchResult(
            chunk_id=1,
            document_id=1,
            course_id=1,
            user_id=1,
            page=2,
            text="Pipelining hazard",
            score=0.9,
        ),
        SearchResult(
            chunk_id=2,
            document_id=1,
            course_id=1,
            user_id=1,
            page=4,
            text="Branch prediction",
            score=0.85,
        ),
    ]

    raw_tutor_answer = (
        "Structural hazards happen when resources are busy [doc p.2]. "
        "Branch predictors mitigate control hazards [doc p.4]."
    )

    guard_res = check_output_guardrails(raw_tutor_answer, mock_chunks)
    assert guard_res.is_grounded is True
    assert "[doc p.2]" in guard_res.citations
    assert "[doc p.4]" in guard_res.citations

    # Verify dedicated Sources section
    assert "**Sources:**" in guard_res.clean_reply
    assert "- [doc p.2]" in guard_res.clean_reply
    assert "- [doc p.4]" in guard_res.clean_reply
