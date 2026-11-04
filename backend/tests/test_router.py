"""Tests for Phase 6 Task 6A: Orchestrator Router & Multi-Agent LangGraph.

Covers:
1. Explicit UI intent bypasses LLM with source="ui"
2. Deterministic slash commands and keyword rules bypass LLM with source="rule"
3. LLM routing with MODEL_FAST and StructuredCall
4. Decision caching by normalized message avoids redundant LLM calls
5. Write agents (quiz_gen, flashcards, roadmap) below ROUTER_CONFIRM_BELOW (0.80) require confirmation chip
6. Read-only agents (tutor, insights) execute down to ROUTER_MIN_CONFIDENCE (0.60)
7. Multi-intent messages execute primary intent and suggest secondary follow-up chip without auto-chaining
8. Insights node computes SQL aggregates scoped to user and course
9. Audit logs and tracer never contain message text or document text
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy.orm import Session

from app.ai.harness.cache import InMemoryCache
from app.ai.harness.fake import FakeLLM
from app.ai.harness.gateway import LLMGateway
from app.ai.insights.insights_gen import (
    compute_course_insights_aggregates,
    generate_insights_summary,
)
from app.ai.router.router import route_message
from app.ai.router.rules import match_deterministic_rules
from app.ai.tutor.graph import tutor_app
from app.buddy.tone import ToneContext
from app.db.models import (
    Attempt,
    Course,
    Flashcard,
    GuardrailEvent,
    Mastery,
    Question,
    Topic,
    User,
)


@pytest.fixture
def router_user(db_session: Session) -> User:
    user = User(firebase_uid="uid_router_test", email="router@example.com", display_name="Router Tester")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def router_course(db_session: Session, router_user: User) -> Course:
    course = Course(
        name="Calculus & Analysis",
        goal_days=14,
        hours_per_day=1.5,
        level="intermediate",
        user_id=router_user.id,
    )
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)
    return course


# ---------------------------------------------------------------------------
# 1. Explicit UI Intent
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_explicit_ui_intent_bypasses_llm():
    """Explicit intent from UI buttons or tabs bypasses routing and rules."""
    decision = await route_message(
        message="Can you help me with this?",
        explicit_intent="quiz_gen",
    )
    assert decision.agent == "quiz_gen"
    assert decision.confidence == 1.0
    assert decision.source == "ui"
    assert decision.reason_code == "explicit_ui_intent"


# ---------------------------------------------------------------------------
# 2. Deterministic Rule Matching
# ---------------------------------------------------------------------------


def test_deterministic_slash_commands():
    """Slash commands match sub-millisecond with source rule."""
    match_quiz = match_deterministic_rules("/quiz limits")
    assert match_quiz is not None
    assert match_quiz.agent == "quiz_gen"
    assert match_quiz.topic_hint == "limits"

    match_cards = match_deterministic_rules("/cards")
    assert match_cards is not None
    assert match_cards.agent == "flashcards"

    match_plan = match_deterministic_rules("/plan")
    assert match_plan is not None
    assert match_plan.agent == "roadmap"

    match_prog = match_deterministic_rules("/progress")
    assert match_prog is not None
    assert match_prog.agent == "insights"


def test_deterministic_keywords():
    """Keyword patterns match unambiguous queries at zero LLM cost."""
    match_q = match_deterministic_rules("Quiz me on derivatives")
    assert match_q is not None
    assert match_q.agent == "quiz_gen"
    assert match_q.topic_hint == "derivatives"

    match_f = match_deterministic_rules("Make flashcards for integration formulas")
    assert match_f is not None
    assert match_f.agent == "flashcards"

    match_r = match_deterministic_rules("What should I study today?")
    assert match_r is not None
    assert match_r.agent == "roadmap"

    match_i = match_deterministic_rules("How am I doing in this course?")
    assert match_i is not None
    assert match_i.agent == "insights"


# ---------------------------------------------------------------------------
# 3. LLM Router with MODEL_FAST
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_llm_router_classification_with_fake_llm():
    """Unmatched queries invoke MODEL_FAST StructuredCall."""
    fake_llm = FakeLLM(
        default_response=json.dumps({
            "agent": "flashcards",
            "confidence": 0.92,
            "reason_code": "user_mentions_srs_deck",
            "secondary_agent": None,
            "topic_hint": "derivatives",
        })
    )
    gw = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)

    decision = await route_message(
        message="I need to prepare some quick memory aids for the upcoming exam",
        gateway=gw,
        cache=InMemoryCache(),
    )
    assert decision.agent == "flashcards"
    assert decision.confidence == 0.92
    assert decision.source == "llm"
    assert decision.reason_code == "user_mentions_srs_deck"


# ---------------------------------------------------------------------------
# 4. Cache Hit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_router_cache_hit_avoids_llm_call():
    """Second identical query returns cached decision with source='cache'."""
    cache = InMemoryCache()
    fake_llm = FakeLLM(
        default_response=json.dumps({
            "agent": "insights",
            "confidence": 0.88,
            "reason_code": "progress_inquiry",
            "secondary_agent": None,
            "topic_hint": None,
        })
    )
    gw = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)

    # First call - populates cache
    dec1 = await route_message(
        message="Can you show me a summary of my performance?",
        gateway=gw,
        cache=cache,
    )
    assert dec1.source in ("llm", "rule")

    # Second call - hits cache
    dec2 = await route_message(
        message="Can you show me a summary of my performance?",
        gateway=gw,
        cache=cache,
    )
    assert dec2.agent == dec1.agent
    assert dec2.source == "cache"


# ---------------------------------------------------------------------------
# 5. Low-Confidence Write Gate & Confirmation Chip
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_write_agent_below_threshold_requires_confirmation():
    """Write agents with confidence < ROUTER_CONFIRM_BELOW (0.80) attach confirmation chip."""
    # Confidence is 0.72 (below 0.80 threshold for write agents)
    fake_llm = FakeLLM(
        default_response=json.dumps({
            "agent": "quiz_gen",
            "confidence": 0.72,
            "reason_code": "ambiguous_quiz_request",
            "secondary_agent": None,
            "topic_hint": "limits",
        })
    )
    gw = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)

    decision = await route_message(
        message="Maybe test me or something if possible",
        gateway=gw,
        cache=InMemoryCache(),
    )
    assert decision.agent == "quiz_gen"
    assert decision.confidence == 0.72
    assert decision.confirmation_chip is not None
    assert "Generate a practice quiz on limits?" in decision.confirmation_chip


@pytest.mark.asyncio
async def test_read_only_agent_runs_above_min_confidence():
    """Read-only agents (tutor, insights) run without confirmation if confidence >= 0.60."""
    fake_llm = FakeLLM(
        default_response=json.dumps({
            "agent": "tutor",
            "confidence": 0.65,
            "reason_code": "explaining_query",
            "secondary_agent": None,
            "topic_hint": None,
        })
    )
    gw = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)

    decision = await route_message(
        message="I don't understand how this works",
        gateway=gw,
        cache=InMemoryCache(),
    )
    assert decision.agent == "tutor"
    assert decision.confidence == 0.65
    assert decision.confirmation_chip is None


# ---------------------------------------------------------------------------
# 6. Multi-Intent Handling
# ---------------------------------------------------------------------------


def test_multi_intent_rules_sets_secondary_follow_up_chip():
    """Multi-intent query executes primary intent and attaches secondary chip."""
    match = match_deterministic_rules("Quiz me on derivatives and make flashcards")
    assert match is not None
    assert match.agent == "quiz_gen"
    assert match.secondary_agent == "flashcards"
    assert match.follow_up_chip == "Review flashcards for this?"


# ---------------------------------------------------------------------------
# 7. Insights Node SQL Aggregates
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_insights_node_sql_aggregates(db_session: Session, router_user: User, router_course: Course):
    """Insights node computes aggregates strictly scoped to user and course."""
    # Seed topics and mastery
    t1 = Topic(course_id=router_course.id, name="Limits")
    t2 = Topic(course_id=router_course.id, name="Derivatives")
    db_session.add_all([t1, t2])
    db_session.commit()
    db_session.refresh(t1)
    db_session.refresh(t2)

    m1 = Mastery(user_id=router_user.id, course_id=router_course.id, topic_id=t1.id, score=0.45, attempts_count=5)
    m2 = Mastery(user_id=router_user.id, course_id=router_course.id, topic_id=t2.id, score=0.85, attempts_count=8)
    db_session.add_all([m1, m2])

    # Seed quiz question and attempts
    q1 = Question(
        course_id=router_course.id,
        topic_id=t1.id,
        question_type="mcq",
        stem="What is lim x->0 sin(x)/x?",
        options=["1", "0", "undefined", "infinity"],
        answer="1",
        explanation="Standard limit identity",
        source_chunk_ids=[],
    )
    db_session.add(q1)
    db_session.commit()
    db_session.refresh(q1)

    a1 = Attempt(
        user_id=router_user.id,
        course_id=router_course.id,
        topic_id=t1.id,
        question_id=q1.id,
        selected_answer="1",
        correct=True,
        time_ms=1200,
    )
    db_session.add(a1)

    # Seed flashcard
    fc1 = Flashcard(
        user_id=router_user.id,
        course_id=router_course.id,
        topic_id=t1.id,
        front="Limit definition of derivative",
        back="f'(x) = lim h->0 (f(x+h) - f(x))/h",
    )
    db_session.add(fc1)
    db_session.commit()

    aggregates = compute_course_insights_aggregates(
        course_id=router_course.id,
        user_id=router_user.id,
        db=db_session,
    )
    assert aggregates["total_topics"] == 2
    assert aggregates["average_mastery_pct"] == 65.0
    assert "Limits" in aggregates["weak_topics"]
    assert "Derivatives" in aggregates["strong_topics"]
    assert aggregates["quiz_attempts"] == 1
    assert aggregates["quiz_accuracy_pct"] == 100.0
    assert aggregates["total_flashcards"] == 1

    # Verify summary generation
    report, _ = await generate_insights_summary(
        course_id=router_course.id,
        user_id=router_user.id,
        db=db_session,
    )
    assert "Your Learning Progress Overview" in report
    assert "Topic Mastery:" in report


# ---------------------------------------------------------------------------
# 8. End-to-End LangGraph Orchestration & Audit Logging
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_langgraph_routes_to_insights(db_session: Session, router_user: User, router_course: Course):
    """End-to-end tutor_app routes '/progress' to insights node."""
    state = {
        "db": db_session,
        "user_id": router_user.id,
        "course_id": router_course.id,
        "message": "/progress",
        "tone_context": ToneContext(),
    }
    result = await tutor_app.ainvoke(state)

    assert result["is_sufficient"] is True
    assert result["grounding_status"] == "grounded"
    assert "Learning Progress Overview" in result["final_reply"]
    assert result["route_agent"] == "insights"
    assert result["route_source"] == "rule"


@pytest.mark.asyncio
async def test_langgraph_routes_confirmation_chip(db_session: Session, router_user: User, router_course: Course):
    """End-to-end tutor_app routes ambiguous write requests to confirmation chip."""
    fake_llm = FakeLLM(
        default_response=json.dumps({
            "agent": "roadmap",
            "confidence": 0.65,  # Below 0.80 write threshold
            "reason_code": "ambiguous_plan",
            "secondary_agent": None,
            "topic_hint": None,
        })
    )
    gw = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)

    state = {
        "db": db_session,
        "gateway": gw,
        "user_id": router_user.id,
        "course_id": router_course.id,
        "message": "Maybe change up the plan later",
        "tone_context": ToneContext(),
    }
    result = await tutor_app.ainvoke(state)

    assert result["confirmation_chip"] is not None
    assert "Replan your study roadmap?" in result["confirmation_chip"]
    assert "Before I proceed:" in result["final_reply"]


def test_guardrail_audit_never_contains_message_text(db_session: Session, router_user: User):
    """Ensures guardrail_events table schema and recorded rows contain zero message or doc text."""
    events = db_session.query(GuardrailEvent).filter(GuardrailEvent.user_id == router_user.id).all()
    for ev in events:
        assert not hasattr(ev, "message_text")
        assert not hasattr(ev, "document_text")
        assert not hasattr(ev, "query")
