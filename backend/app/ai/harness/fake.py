"""Deterministic Fake LLM implementation for tests.

Provides scripted responses, scripted failures (rate limits, timeouts, invalid json),
call tracking, and zero network calls.
"""

from dataclasses import dataclass
from typing import Any

from app.ai.harness.exceptions import (
    ProviderUnavailableError,
    RateLimitExceededError,
    TimeoutError,
)
from app.ai.harness.models import LLMRequest, LLMResponse


@dataclass
class ScriptedCall:
    """Pre-programmed response or error for a FakeLLM invocation."""

    content: str | None = None
    exception: Exception | None = None
    tokens_in: int = 50
    tokens_out: int = 50
    latency_ms: float = 10.0


class FakeLLM:
    """Mock LLM engine that returns deterministic scripted responses or exceptions."""

    def __init__(self, default_response: str = '{"status": "ok"}'):
        self.default_response = default_response
        self._scripted_queue: list[ScriptedCall] = []
        self._provider_queues: dict[str, list[ScriptedCall]] = {}
        self.history: list[dict[str, Any]] = []
        self.call_count: int = 0

    def add_response(
        self,
        content: str,
        tokens_in: int = 50,
        tokens_out: int = 50,
        latency_ms: float = 10.0,
    ) -> None:
        """Enqueue a successful scripted response."""
        self._scripted_queue.append(
            ScriptedCall(
                content=content,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                latency_ms=latency_ms,
            )
        )

    def add_provider_response(
        self,
        provider: str,
        content: str,
        tokens_in: int = 50,
        tokens_out: int = 50,
        latency_ms: float = 10.0,
    ) -> None:
        """Enqueue a successful response specific to a provider."""
        self._provider_queues.setdefault(provider, []).append(
            ScriptedCall(
                content=content,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                latency_ms=latency_ms,
            )
        )

    def add_failure(self, exception: Exception) -> None:
        """Enqueue an exception to be raised on the next call."""
        self._scripted_queue.append(ScriptedCall(exception=exception))

    def add_provider_failure(self, provider: str, exception: Exception) -> None:
        """Enqueue an exception specific to a provider."""
        self._provider_queues.setdefault(provider, []).append(
            ScriptedCall(exception=exception)
        )

    def add_rate_limit_failure(self, provider: str | None = None) -> None:
        """Convenience method to enqueue a 429 rate limit failure."""
        err = RateLimitExceededError("Simulated 429 rate limit exceeded")
        if provider:
            self.add_provider_failure(provider, err)
        else:
            self.add_failure(err)

    def add_timeout_failure(self, provider: str | None = None) -> None:
        """Convenience method to enqueue a timeout failure."""
        err = TimeoutError("Simulated LLM call timeout")
        if provider:
            self.add_provider_failure(provider, err)
        else:
            self.add_failure(err)

    def add_server_error(self, provider: str | None = None) -> None:
        """Convenience method to enqueue a 500 server error."""
        err = ProviderUnavailableError("Simulated 500 internal server error")
        if provider:
            self.add_provider_failure(provider, err)
        else:
            self.add_failure(err)

    def reset(self) -> None:
        """Reset state, queues, and call history."""
        self._scripted_queue.clear()
        self._provider_queues.clear()
        self.history.clear()
        self.call_count = 0

    async def complete(
        self,
        request: LLMRequest,
        provider: str,
        model: str,
    ) -> LLMResponse:
        """Simulate LLM execution for a request against given provider and model."""
        self.call_count += 1
        self.history.append(
            {
                "call_index": self.call_count,
                "provider": provider,
                "model": model,
                "role": str(request.role),
                "messages_count": len(request.messages),
                "request_id": request.request_id,
                "user_id": request.user_id,
            }
        )

        # Check provider-specific queue first
        scripted: ScriptedCall | None = None
        if provider in self._provider_queues and self._provider_queues[provider]:
            scripted = self._provider_queues[provider].pop(0)
        elif self._scripted_queue:
            scripted = self._scripted_queue.pop(0)

        if scripted is not None:
            if scripted.exception is not None:
                raise scripted.exception
            return LLMResponse(
                content=scripted.content or self.default_response,
                provider=provider,
                model=model,
                role=str(request.role),
                tokens_in=scripted.tokens_in,
                tokens_out=scripted.tokens_out,
                latency_ms=scripted.latency_ms,
            )

        # Fallback to default response
        return LLMResponse(
            content=self.default_response,
            provider=provider,
            model=model,
            role=str(request.role),
            tokens_in=40,
            tokens_out=20,
            latency_ms=15.0,
        )

    __call__ = complete
