"""Orchestrator Router implementation following README Section 9.

Resolution order:
1. Explicit UI intent (intent field, no LLM)
2. Rules (regex/keywords, zero cost, sub-millisecond)
3. ONE MODEL_FAST StructuredCall at temperature 0
4. Low-confidence handling (read-only run; write agents require confirmation chip)
5. Multi-intent handling (primary intent executed, secondary offered as follow-up chip)
6. Cached by normalized message hash (never logs message text)
"""

from __future__ import annotations

import logging
import time
from typing import Any

from pydantic import BaseModel, Field

from app.ai.harness.cache import CacheInterface, InMemoryCache, make_router_cache_key
from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import ChatMessage, ModelRole
from app.ai.harness.structured import StructuredCall
from app.ai.router.rules import SECONDARY_CHIPS, match_deterministic_rules
from app.ai.router.schemas import (
    READ_ONLY_AGENTS,
    WRITE_AGENTS,
    AgentType,
    RouteDecision,
)
from app.core.config import settings

logger = logging.getLogger(__name__)

# Module-level routing cache
_default_router_cache = InMemoryCache(max_size=5_000)


class RouteDecisionLLMOutput(BaseModel):
    """Schema returned by MODEL_FAST router call."""

    agent: AgentType = Field(
        description="The chosen specialist agent: 'tutor', 'quiz_gen', 'flashcards', 'roadmap', or 'insights'."
    )
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence score between 0.0 and 1.0.",
    )
    reason_code: str = Field(
        description="Short reason code, e.g. 'explaining_concept', 'requesting_quiz', 'requesting_cards'."
    )
    secondary_agent: AgentType | None = Field(
        default=None,
        description="Optional secondary intent if user requested multiple actions.",
    )
    topic_hint: str | None = Field(
        default=None,
        description="Extracted academic topic or concept name if mentioned.",
    )


ROUTER_SYSTEM_PROMPT = f"""You are the intent router for {settings.PRODUCT_NAME}, a study companion platform.
Your job is to analyze the student's message and select the single best specialist agent:
- 'tutor': Explaining concepts, textbook questions, formulas, derivations, clarifying topics, or general academic questions.
- 'quiz_gen': Generating quizzes, asking for practice questions, testing knowledge, taking an exam.
- 'flashcards': Generating spaced repetition flashcards, reviewing flashcards, SRS deck questions.
- 'roadmap': Checking study schedule, what to study today/next, viewing learning plan, roadmap re-planning.
- 'insights': Checking progress, mastery breakdown, statistics, weak topics report, study summaries.

Rules:
1. Output valid JSON matching the schema.
2. If the user asks for two distinct tasks (e.g. 'quiz me and make cards'), set the first as 'agent' and the other as 'secondary_agent'.
3. Assign confidence between 0.0 and 1.0. If the request is ambiguous or vague, lower confidence accordingly.
4. Extract the primary academic topic into topic_hint if specified.
"""


def format_confirmation_chip(agent: AgentType, topic_hint: str | None) -> str:
    """Generates user-facing confirmation chip text for write operations."""
    topic = f" on {topic_hint}" if topic_hint else ""
    if agent == "quiz_gen":
        return f"Generate a practice quiz{topic}?"
    elif agent == "flashcards":
        return f"Create study flashcards{topic}?"
    elif agent == "roadmap":
        return "Replan your study roadmap?"
    return "Would you like to proceed?"


async def route_message(
    message: str,
    history: list[dict[str, str]] | None = None,
    explicit_intent: str | None = None,
    gateway: LLMGateway | None = None,
    cache: CacheInterface | None = None,
    user_id: int | None = None,
) -> RouteDecision:
    """Deterministically routes a user message to the correct specialist agent.

    Follows README Section 9 resolution order:
    UI Intent -> Rules -> Cache -> LLM -> Confirmation / Multi-intent handling.
    Logs agent, confidence, source, latency, cache hit — NEVER message text.
    """
    start_time = time.perf_counter()
    router_cache = cache or _default_router_cache
    llm_gw = gateway or LLMGateway()

    # 1. Explicit UI intent (buttons, tabs, intent payload)
    if explicit_intent and explicit_intent in ("tutor", "quiz_gen", "flashcards", "roadmap", "insights"):
        latency_ms = (time.perf_counter() - start_time) * 1000.0
        decision = RouteDecision(
            agent=explicit_intent,  # type: ignore[arg-type]
            confidence=1.0,
            source="ui",
            reason_code="explicit_ui_intent",
        )
        logger.info(
            "Router decision: agent=%s confidence=%.2f source=%s latency_ms=%.1f cache_hit=False",
            decision.agent,
            decision.confidence,
            decision.source,
            latency_ms,
        )
        return decision

    clean_message = message.strip()
    cache_key = make_router_cache_key(clean_message, user_id=user_id)

    # 2. Cache Lookup
    cached_payload: dict[str, Any] | None = router_cache.get(cache_key)
    if cached_payload is not None:
        latency_ms = (time.perf_counter() - start_time) * 1000.0
        decision = RouteDecision.model_validate(cached_payload)
        decision.source = "cache"
        logger.info(
            "Router decision: agent=%s confidence=%.2f source=%s latency_ms=%.1f cache_hit=True",
            decision.agent,
            decision.confidence,
            decision.source,
            latency_ms,
        )
        return decision

    # 3. Deterministic Rules (Regex and keywords, zero cost)
    rule_match = match_deterministic_rules(clean_message)
    if rule_match:
        latency_ms = (time.perf_counter() - start_time) * 1000.0
        decision = RouteDecision(
            agent=rule_match.agent,
            confidence=1.0,
            source="rule",
            reason_code=rule_match.reason,
            secondary_agent=rule_match.secondary_agent,
            follow_up_chip=rule_match.follow_up_chip,
            topic_hint=rule_match.topic_hint,
        )
        router_cache.set(cache_key, decision.model_dump(), ttl_s=3600)
        logger.info(
            "Router decision: agent=%s confidence=%.2f source=%s latency_ms=%.1f cache_hit=False",
            decision.agent,
            decision.confidence,
            decision.source,
            latency_ms,
        )
        return decision

    # 4. LLM Router (MODEL_FAST StructuredCall at temperature 0)
    structured = StructuredCall(gateway=llm_gw)

    # Reconstruct at most 3 short prior messages (role + trimmed snippet, NEVER document text)
    trimmed_context: list[ChatMessage] = [
        ChatMessage(role="system", content=ROUTER_SYSTEM_PROMPT)
    ]
    if history:
        for turn in history[-3:]:
            role = turn.get("role", "user")
            content = turn.get("content", "")[:150]
            if role in ("user", "assistant"):
                trimmed_context.append(ChatMessage(role=role, content=content))

    trimmed_context.append(ChatMessage(role="user", content=clean_message))

    try:
        llm_output: RouteDecisionLLMOutput = await structured.execute(
            schema=RouteDecisionLLMOutput,
            messages=trimmed_context,
            role=ModelRole.FAST,
            temperature=0.0,
            user_id=user_id,
            max_retries=1,
            agent_name="router",
        )
        raw_agent = llm_output.agent
        raw_conf = float(llm_output.confidence)
        reason_code = llm_output.reason_code
        secondary_agent = llm_output.secondary_agent
        topic_hint = llm_output.topic_hint
    except Exception as e:
        logger.warning("Router LLM StructuredCall failed, falling back to tutor: %s", e)
        raw_agent = "tutor"
        raw_conf = 0.5
        reason_code = "llm_fallback"
        secondary_agent = None
        topic_hint = None

    # 5. Low-Confidence Handling and Write Safety Gating
    confirmation_chip: str | None = None
    follow_up_chip: str | None = None

    min_conf = settings.ROUTER_MIN_CONFIDENCE
    confirm_below = settings.ROUTER_CONFIRM_BELOW

    chosen_agent = raw_agent

    # For write agents: require confidence >= confirm_below, else attach confirmation chip
    if chosen_agent in WRITE_AGENTS:
        if raw_conf < confirm_below:
            confirmation_chip = format_confirmation_chip(chosen_agent, topic_hint)
    elif chosen_agent in READ_ONLY_AGENTS:
        # Read-only agents run down to min_conf; below min_conf fallback to tutor
        if raw_conf < min_conf:
            chosen_agent = "tutor"
            reason_code = "low_confidence_fallback"

    # Multi-intent follow-up chip
    if secondary_agent and secondary_agent in SECONDARY_CHIPS:
        follow_up_chip = SECONDARY_CHIPS[secondary_agent]

    latency_ms = (time.perf_counter() - start_time) * 1000.0
    decision = RouteDecision(
        agent=chosen_agent,
        confidence=raw_conf,
        source="llm",
        reason_code=reason_code,
        secondary_agent=secondary_agent,
        confirmation_chip=confirmation_chip,
        follow_up_chip=follow_up_chip,
        topic_hint=topic_hint,
    )

    # Cache decision
    router_cache.set(cache_key, decision.model_dump(), ttl_s=3600)

    logger.info(
        "Router decision: agent=%s confidence=%.2f source=%s latency_ms=%.1f cache_hit=False reason=%s",
        decision.agent,
        decision.confidence,
        decision.source,
        latency_ms,
        decision.reason_code,
    )
    return decision
