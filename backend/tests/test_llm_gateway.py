"""Tests for LLMGateway: provider failover, retries, timeouts, circuit breaking, and rate limits."""

import pytest

from app.ai.harness.exceptions import (
    ProviderUnavailableError,
)
from app.ai.harness.fake import FakeLLM
from app.ai.harness.gateway import CircuitBreaker, LLMGateway, parse_model_slugs
from app.ai.harness.models import ChatMessage, LLMRequest, ModelRole


@pytest.fixture
def fake_llm():
    return FakeLLM(default_response="Mock gateway reply")


@pytest.mark.asyncio
async def test_gateway_successful_completion(fake_llm):
    gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)
    request = LLMRequest(
        messages=[ChatMessage(role="user", content="Hello")],
        role=ModelRole.FAST,
    )

    response = await gateway.complete(request)
    assert response.content == "Mock gateway reply"
    assert response.status == "success"
    assert fake_llm.call_count == 1


@pytest.mark.asyncio
async def test_gateway_provider_failover_on_429(fake_llm):
    gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)
    # Configure first provider in chain (openrouter) to fail with rate limit
    fake_llm.add_rate_limit_failure(provider="openrouter")
    # Second provider (groq) will succeed with default response

    request = LLMRequest(
        messages=[ChatMessage(role="user", content="Testing 429 failover")],
        role=ModelRole.FAST,
    )

    response = await gateway.complete(request)
    # Successful response came from failover provider
    assert response.provider == "groq"
    assert response.content == "Mock gateway reply"


@pytest.mark.asyncio
async def test_gateway_provider_failover_on_timeout(fake_llm):
    gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)
    # First provider openrouter times out on all retries
    fake_llm.add_timeout_failure(provider="openrouter")
    fake_llm.add_timeout_failure(provider="openrouter")
    fake_llm.add_timeout_failure(provider="openrouter")

    request = LLMRequest(
        messages=[ChatMessage(role="user", content="Testing timeout failover")],
        role=ModelRole.FAST,
    )

    response = await gateway.complete(request)
    assert response.provider == "groq"
    assert response.content == "Mock gateway reply"


@pytest.mark.asyncio
async def test_gateway_all_providers_exhausted(fake_llm):
    gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)
    # Make all providers fail with server error
    for provider in gateway.chain:
        for _ in range(3):
            fake_llm.add_provider_failure(provider, ProviderUnavailableError(f"{provider} down"))

    request = LLMRequest(
        messages=[ChatMessage(role="user", content="Testing exhaustion")],
        role=ModelRole.FAST,
    )

    with pytest.raises(ProviderUnavailableError, match="All providers in chain"):
        await gateway.complete(request)


def test_circuit_breaker_state_transitions():
    cb = CircuitBreaker(failure_threshold=2, recovery_time_s=0.1)
    assert cb.is_available() is True
    assert cb.state == "CLOSED"

    cb.record_failure()
    assert cb.state == "CLOSED"
    assert cb.is_available() is True

    # Reaching threshold trips breaker to OPEN
    cb.record_failure()
    assert cb.state == "OPEN"
    assert cb.is_available() is False

    # Simulate waiting past recovery time
    cb.last_failure_time -= 0.2
    assert cb.is_available() is True
    assert cb.state == "HALF_OPEN"

    # Success in HALF_OPEN resets breaker
    cb.record_success()
    assert cb.state == "CLOSED"
    assert cb.failure_count == 0


@pytest.mark.asyncio
async def test_gateway_skips_open_circuit_breaker(fake_llm):
    gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)
    # Trip openrouter's circuit breaker
    cb = gateway.circuit_breakers["openrouter"]
    cb.state = "OPEN"
    cb.last_failure_time = 9999999999.0  # Far in future

    request = LLMRequest(
        messages=[ChatMessage(role="user", content="Test breaker skip")],
        role=ModelRole.FAST,
    )

    response = await gateway.complete(request)
    # Should have skipped openrouter and called groq directly
    assert response.provider == "groq"
    assert fake_llm.history[0]["provider"] == "groq"


def test_parse_model_slugs():
    config_val = "openrouter:anthropic/claude-3-haiku|groq:llama3-70b-8192"
    parsed = parse_model_slugs(config_val)
    assert parsed["openrouter"] == "anthropic/claude-3-haiku"
    assert parsed["groq"] == "llama3-70b-8192"
    assert parse_model_slugs(None) == {}
