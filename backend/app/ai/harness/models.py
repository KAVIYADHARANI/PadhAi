"""Data models and schemas for the AI Agent Harness.

Strictly type-annotated definitions for requests, responses, roles, and provider configs.
"""

import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class ModelRole(StrEnum):
    """Configured model roles per README section 4 / 7."""

    SMART = "MODEL_SMART"
    FAST = "MODEL_FAST"
    VISION = "MODEL_VISION"


@dataclass
class ChatMessage:
    """Message item in an LLM conversation."""

    role: str  # "system", "user", "assistant"
    content: str


@dataclass
class LLMRequest:
    """Input request sent to the LLMGateway."""

    messages: list[ChatMessage]
    role: ModelRole | str = ModelRole.FAST
    temperature: float = 0.0
    max_tokens: int | None = None
    response_format: dict[str, Any] | None = None
    user_id: int | None = None
    course_id: int | None = None
    request_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    agent_name: str = "default"
    cacheable: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class LLMResponse:
    """Standardized response returned by LLMGateway."""

    content: str
    provider: str
    model: str
    role: str
    tokens_in: int
    tokens_out: int
    latency_ms: float
    retries: int = 0
    status: str = "success"
    cached: bool = False
    raw_response: dict[str, Any] | None = None

    @property
    def text(self) -> str:
        """Alias for content."""
        return self.content


@dataclass
class ProviderConfig:
    """Configuration for an individual LLM provider."""

    name: str
    api_keys: list[str]
    base_url: str
    rate_limit_rpm: int = 60
    rate_limit_tpm: int = 100_000
    supports_json_schema: bool = True
