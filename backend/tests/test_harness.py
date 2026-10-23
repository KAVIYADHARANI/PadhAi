"""Unit tests for the AI Harness components."""

import time

import pytest
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.ai.harness.budget import DailyUserBudget, RequestBudget
from app.ai.harness.cache import (
    InMemoryCache,
    make_embedding_cache_key,
    make_generated_set_cache_key,
    make_router_cache_key,
)
from app.ai.harness.exceptions import (
    BudgetExhaustedError,
    ProviderUnavailableError,
    RateLimitExceededError,
    StructuredOutputError,
    TimeoutError,
)
from app.ai.harness.fake import FakeLLM
from app.ai.harness.gateway import CircuitBreaker, LLMGateway
from app.ai.harness.models import ChatMessage, LLMRequest, ModelRole
from app.ai.harness.structured import StructuredCall
from app.ai.harness.tracer import TraceEvent, Tracer
from app.core.config import settings


# 1. Gateway Failover on 429
@pytest.mark.asyncio
async def test_gateway_failover_on_429(monkeypatch):
    monkeypatch.setattr(settings, "LLM_CHAIN", "openrouter,groq")
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "test_or_key")
    monkeypatch.setattr(settings, "GROQ_API_KEY", "test_groq_key")
    monkeypatch.setattr(settings, "MODEL_SMART", "openrouter:or-slug|groq:groq-slug")

    fake = FakeLLM()
    # 1st call to openrouter fails with 429
    fake.add_provider_failure("openrouter", RateLimitExceededError("Rate limit hit"))
    # 2nd call to groq succeeds
    fake.add_provider_response("groq", "Success from Groq")

    gateway = LLMGateway(caller=fake, base_backoff_s=0.01)
    req = LLMRequest(
        messages=[ChatMessage(role="user", content="Explain gravity")],
        role=ModelRole.SMART,
    )

    resp = await gateway.complete(req)
    assert resp.content == "Success from Groq"
    assert resp.provider == "groq"
    assert resp.model == "groq-slug"


# 2. Gateway Failover on Timeout
@pytest.mark.asyncio
async def test_gateway_failover_on_timeout(monkeypatch):
    monkeypatch.setattr(settings, "LLM_CHAIN", "openrouter,groq")
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "test_or_key")
    monkeypatch.setattr(settings, "GROQ_API_KEY", "test_groq_key")
    monkeypatch.setattr(settings, "MODEL_SMART", "openrouter:or-slug|groq:groq-slug")
    monkeypatch.setattr(settings, "LLM_MAX_RETRIES", 0)

    fake = FakeLLM()
    # 1st call times out
    fake.add_provider_failure("openrouter", TimeoutError("Request timed out"))
    # 2nd call to groq succeeds
    fake.add_provider_response("groq", "Success after timeout")

    gateway = LLMGateway(caller=fake, base_backoff_s=0.01)
    req = LLMRequest(
        messages=[ChatMessage(role="user", content="Explain gravity")],
        role=ModelRole.SMART,
    )

    resp = await gateway.complete(req)
    assert resp.content == "Success after timeout"
    assert resp.provider == "groq"


# 3. All Providers Failed Error
@pytest.mark.asyncio
async def test_all_providers_failed_raises_error(monkeypatch):
    monkeypatch.setattr(settings, "LLM_CHAIN", "openrouter")
    monkeypatch.setattr(settings, "OPENROUTER_API_KEY", "test_key")
    monkeypatch.setattr(settings, "MODEL_SMART", "openrouter:or-slug")
    monkeypatch.setattr(settings, "LLM_MAX_RETRIES", 0)

    fake = FakeLLM()
    fake.add_provider_failure("openrouter", ProviderUnavailableError("Server down"))

    gateway = LLMGateway(caller=fake, base_backoff_s=0.01)
    req = LLMRequest(
        messages=[ChatMessage(role="user", content="Prompt")],
        role=ModelRole.SMART,
    )

    with pytest.raises(ProviderUnavailableError):
        await gateway.complete(req)


# 4. Circuit Breaker Trips and Recovers
def test_circuit_breaker_trip_and_recovery():
    cb = CircuitBreaker(failure_threshold=3, recovery_time_s=0.1)
    assert cb.state == "CLOSED"
    assert cb.is_available() is True

    # 3 failures trip circuit to OPEN
    cb.record_failure()
    cb.record_failure()
    assert cb.state == "CLOSED"
    cb.record_failure()
    assert cb.state == "OPEN"
    assert cb.is_available() is False

    # Wait for recovery window
    time.sleep(0.12)
    assert cb.is_available() is True
    assert cb.state == "HALF_OPEN"

    # Success resets to CLOSED
    cb.record_success()
    assert cb.state == "CLOSED"
    assert cb.failure_count == 0


# 5. StructuredCall Validation and Retry Recovery
class MockQuizAnswer(BaseModel):
    question_id: int
    answer: str
    confidence: float


@pytest.mark.asyncio
async def test_structured_call_retry_and_success():
    fake = FakeLLM()
    # Attempt 1: Malformed JSON
    fake.add_response("Not a json string")
    # Attempt 2: Valid JSON
    fake.add_response('{"question_id": 101, "answer": "B", "confidence": 0.95}')

    gateway = LLMGateway(caller=fake, base_backoff_s=0.01)
    structured = StructuredCall(gateway=gateway)

    messages = [ChatMessage(role="user", content="Answer this question")]
    res = await structured.execute(
        schema=MockQuizAnswer,
        messages=messages,
        role=ModelRole.FAST,
        max_retries=2,
    )

    assert isinstance(res, MockQuizAnswer)
    assert res.question_id == 101
    assert res.answer == "B"
    assert res.confidence == 0.95
    assert fake.call_count == 2


@pytest.mark.asyncio
async def test_structured_call_exhaustion_raises_error():
    fake = FakeLLM()
    fake.add_response("Invalid JSON 1")
    fake.add_response("Invalid JSON 2")
    fake.add_response("Invalid JSON 3")

    gateway = LLMGateway(caller=fake, base_backoff_s=0.01)
    structured = StructuredCall(gateway=gateway)

    messages = [ChatMessage(role="user", content="Answer this question")]
    with pytest.raises(StructuredOutputError):
        await structured.execute(
            schema=MockQuizAnswer,
            messages=messages,
            role=ModelRole.FAST,
            max_retries=2,
        )


# 6. RequestBudget Enforcement
def test_request_budget_call_and_token_caps():
    budget = RequestBudget(max_calls=2, max_tokens=100)

    # Call 1: 40 tokens
    budget.consume(calls=1, tokens_in=20, tokens_out=20)
    budget.check_budget()

    # Call 2: 40 tokens
    budget.consume(calls=1, tokens_in=20, tokens_out=20)
    budget.check_budget()

    # Call 3: Call limit exhausted
    with pytest.raises(BudgetExhaustedError, match="call limit reached"):
        budget.consume(calls=1, tokens_in=10, tokens_out=10)


def test_request_budget_tool_rounds():
    budget = RequestBudget(max_tool_rounds=2)
    budget.consume(tool_rounds=1)
    budget.consume(tool_rounds=1)

    with pytest.raises(BudgetExhaustedError, match="tool round limit reached"):
        budget.consume(tool_rounds=1)


# 7. DailyUserBudget Enforcement
def test_user_daily_quota_enforcement(db_session: Session):
    test_user_id = 42

    # Under limit
    DailyUserBudget.record_usage(db_session, user_id=test_user_id, provider="groq", model="llama", calls=5)
    DailyUserBudget.check_daily_quota(db_session, user_id=test_user_id, daily_limit=10)

    # Reach limit
    DailyUserBudget.record_usage(db_session, user_id=test_user_id, provider="groq", model="llama", calls=5)
    with pytest.raises(BudgetExhaustedError, match="Daily quota of 10 LLM calls exceeded"):
        DailyUserBudget.check_daily_quota(db_session, user_id=test_user_id, daily_limit=10)


# 8. Cache Operations and Deterministic Hashing
def test_cache_operations_and_keys():
    cache = InMemoryCache()
    assert cache.get("missing_key") is None

    cache.set("key1", "val1")
    assert cache.get("key1") == "val1"

    # Expiry
    cache.set("temp", "expiring", ttl_s=0.05)
    time.sleep(0.06)
    assert cache.get("temp") is None

    # Deterministic keys
    key1 = make_embedding_cache_key("  Hello   World  ", "bge-m3")
    key2 = make_embedding_cache_key("Hello World", "bge-m3")
    assert key1 == key2

    r_key1 = make_router_cache_key("Quiz Me On Biology")
    r_key2 = make_router_cache_key("quiz   me   on biology")
    assert r_key1 == r_key2

    set_key1 = make_generated_set_cache_key(10, ["hashB", "hashA"])
    set_key2 = make_generated_set_cache_key(10, ["hashA", "hashB"])
    assert set_key1 == set_key2


# 9. Tracer API Strictly Forbids Text Payloads
def test_tracer_record_schema():
    event = TraceEvent(
        request_id="req_123",
        user_id=1,
        course_id=10,
        agent="tutor",
        provider="groq",
        model="llama3",
        latency_ms=120.5,
        tokens_in=100,
        tokens_out=250,
        retries=1,
        status="success",
    )
    assert event.tokens_in == 100
    assert event.latency_ms == 120.5

    # Assert passing unexpected text fields like 'prompt' is impossible on slotted dataclass
    with pytest.raises(TypeError):
        TraceEvent(
            request_id="req_123",
            user_id=1,
            course_id=10,
            agent="tutor",
            provider="groq",
            model="llama3",
            latency_ms=10.0,
            tokens_in=10,
            tokens_out=10,
            retries=0,
            status="success",
            prompt="Prohibited prompt text",  # type: ignore
        )

    tracer = Tracer()
    tracer.record(
        request_id="req_123",
        user_id=1,
        course_id=10,
        agent="tutor",
        provider="groq",
        model="llama3",
        latency_ms=120.5,
        tokens_in=100,
        tokens_out=250,
        retries=0,
        status="success",
    )
