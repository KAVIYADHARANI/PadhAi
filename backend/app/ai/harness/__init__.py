"""AI Agent Harness package.

Exports centralized LLM gateway, structured validation, budget enforcement,
privacy-safe tracing, caching, guardrail hooks, and test fake.
"""

from app.ai.harness.budget import DailyUserBudget, RequestBudget
from app.ai.harness.cache import (
    CacheInterface,
    InMemoryCache,
    make_embedding_cache_key,
    make_generated_set_cache_key,
    make_router_cache_key,
    make_structured_call_cache_key,
)
from app.ai.harness.exceptions import (
    BudgetExhaustedError,
    CircuitBreakerOpenError,
    DailyQuotaExhaustedError,
    GuardrailViolationError,
    HarnessError,
    ProviderUnavailableError,
    RateLimitExceededError,
    StructuredOutputError,
    TimeoutError,
)
from app.ai.harness.fake import FakeLLM, ScriptedCall
from app.ai.harness.gateway import CircuitBreaker, LLMGateway, ProviderRateLimiter
from app.ai.harness.guardrails import GuardrailHooks, PostCallHook, PreCallHook
from app.ai.harness.models import (
    ChatMessage,
    LLMRequest,
    LLMResponse,
    ModelRole,
    ProviderConfig,
)
from app.ai.harness.structured import StructuredCall
from app.ai.harness.tracer import TraceEvent, Tracer

__all__ = [
    "BudgetExhaustedError",
    "CacheInterface",
    "ChatMessage",
    "CircuitBreaker",
    "CircuitBreakerOpenError",
    "DailyQuotaExhaustedError",
    "DailyUserBudget",
    "FakeLLM",
    "GuardrailHooks",
    "GuardrailViolationError",
    "HarnessError",
    "InMemoryCache",
    "LLMGateway",
    "LLMRequest",
    "LLMResponse",
    "ModelRole",
    "PostCallHook",
    "PreCallHook",
    "ProviderConfig",
    "ProviderRateLimiter",
    "ProviderUnavailableError",
    "RateLimitExceededError",
    "RequestBudget",
    "ScriptedCall",
    "StructuredCall",
    "StructuredOutputError",
    "TimeoutError",
    "TraceEvent",
    "Tracer",
    "make_embedding_cache_key",
    "make_generated_set_cache_key",
    "make_router_cache_key",
    "make_structured_call_cache_key",
]
