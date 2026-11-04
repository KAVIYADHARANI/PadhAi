"""Schemas for router decisions and multi-agent intent routing."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

AgentType = Literal["tutor", "quiz_gen", "flashcards", "roadmap", "insights"]
RouteSource = Literal["ui", "rule", "llm", "cache"]

WRITE_AGENTS: set[AgentType] = {"quiz_gen", "flashcards", "roadmap"}
READ_ONLY_AGENTS: set[AgentType] = {"tutor", "insights"}


class RouteDecision(BaseModel):
    """Routing classification decision produced by UI, deterministic rules, or LLM router."""

    agent: AgentType = Field(
        description="The target specialist agent to handle the user message."
    )
    confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Confidence score for this routing decision between 0.0 and 1.0.",
    )
    source: RouteSource = Field(
        default="rule",
        description="Origin of the routing decision: explicit UI, deterministic rule, LLM, or cache.",
    )
    reason_code: str = Field(
        default="rule_match",
        description="Short code or explanation rationale for the decision.",
    )
    secondary_agent: AgentType | None = Field(
        default=None,
        description="Optional secondary agent identified for multi-intent handling.",
    )
    confirmation_chip: str | None = Field(
        default=None,
        description="Confirmation chip prompt if confidence is below confirmation threshold for write operations.",
    )
    follow_up_chip: str | None = Field(
        default=None,
        description="Follow-up chip text suggested for a secondary intent.",
    )
    topic_hint: str | None = Field(
        default=None,
        description="Extracted topic or subject focus, if mentioned in the message.",
    )
