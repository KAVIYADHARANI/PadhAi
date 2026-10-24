"""Centralized LLM Gateway for learning companion backend.

Features:
- Single OpenAI-compatible client interface over ordered failover chain (LLM_CHAIN).
- Dynamic model slug resolution per role (MODEL_SMART, MODEL_FAST, MODEL_VISION).
- Per-provider rate-limit tracking read from config.
- Circuit breaker to avoid calling persistently failing providers.
- Bounded jittered retries up to LLM_MAX_RETRIES with timeout LLM_TIMEOUT_S.
- Key rotation for multiple comma-separated API keys.
- Pluggable mock/engine (e.g. FakeLLM) for zero-network testing.
"""

import asyncio
import logging
import random
import time
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.ai.harness.exceptions import (
    AuthenticationError,
    ProviderUnavailableError,
    RateLimitExceededError,
    TimeoutError,
)
from app.ai.harness.models import LLMRequest, LLMResponse, ModelRole
from app.core.config import settings

logger = logging.getLogger("app.gateway")


@dataclass
class CircuitBreaker:
    """Circuit breaker for an individual provider."""

    failure_threshold: int = 3
    recovery_time_s: float = 30.0
    failure_count: int = 0
    state: str = "CLOSED"  # CLOSED, OPEN, HALF_OPEN
    last_failure_time: float = 0.0

    def is_available(self) -> bool:
        if self.state == "CLOSED":
            return True
        now = time.time()
        if self.state == "OPEN":
            if now - self.last_failure_time >= self.recovery_time_s:
                self.state = "HALF_OPEN"
                return True
            return False
        return True  # HALF_OPEN allows trial call

    def record_success(self) -> None:
        self.failure_count = 0
        self.state = "CLOSED"

    def record_failure(self) -> None:
        self.failure_count += 1
        self.last_failure_time = time.time()
        if self.failure_count >= self.failure_threshold:
            self.state = "OPEN"


@dataclass
class ProviderRateLimiter:
    """Sliding-window rate limiter per provider tracking requests per minute (RPM)."""

    rpm_limit: int = 60
    _timestamps: list[float] = field(default_factory=list)

    def can_call(self) -> bool:
        now = time.time()
        cutoff = now - 60.0
        self._timestamps = [t for t in self._timestamps if t > cutoff]
        return len(self._timestamps) < self.rpm_limit

    def record_call(self) -> None:
        self._timestamps.append(time.time())


def parse_model_slugs(slug_config: str | None) -> dict[str, str]:
    """Parse 'provider:slug|provider:slug' configuration format."""
    result: dict[str, str] = {}
    if not slug_config:
        return result
    for pair in slug_config.split("|"):
        pair = pair.strip()
        if ":" in pair:
            provider, slug = pair.split(":", 1)
            result[provider.strip().lower()] = slug.strip()
    return result


class LLMGateway:
    """Orchestrates LLM calls across hosted providers with retries, failover, and circuit breaking."""

    def __init__(
        self,
        caller: Callable[[LLMRequest, str, str], Coroutine[Any, Any, LLMResponse]] | None = None,
        base_backoff_s: float = 0.1,
        max_backoff_s: float = 2.0,
    ):
        self._custom_caller = caller
        self._base_backoff_s = base_backoff_s
        self._max_backoff_s = max_backoff_s

        # Parse provider chains and roles
        self.chain: list[str] = [
            p.strip().lower() for p in settings.LLM_CHAIN.split(",") if p.strip()
        ]
        self.smart_slugs = parse_model_slugs(settings.MODEL_SMART)
        self.fast_slugs = parse_model_slugs(settings.MODEL_FAST)
        self.vision_slugs = parse_model_slugs(settings.MODEL_VISION)

        # Provider endpoint bases
        self._provider_base_urls: dict[str, str] = {
            "openrouter": "https://openrouter.ai/api/v1",
            "groq": "https://api.groq.com/openai/v1",
            "cerebras": "https://api.cerebras.ai/v1",
            "google": "https://generativelanguage.googleapis.com/v1beta/openai",
        }

        # Circuit breakers & rate limiters per provider
        self.circuit_breakers: dict[str, CircuitBreaker] = {p: CircuitBreaker() for p in self.chain}
        self.rate_limiters: dict[str, ProviderRateLimiter] = {
            p: ProviderRateLimiter(rpm_limit=60) for p in self.chain
        }
        # Key rotation tracker: provider -> (keys_list, current_index)
        self._api_keys: dict[str, list[str]] = self._init_provider_keys()
        self._key_indices: dict[str, int] = {p: 0 for p in self.chain}

    def _init_provider_keys(self) -> dict[str, list[str]]:
        keys: dict[str, list[str]] = {}
        for p in self.chain:
            raw_key = ""
            if p == "openrouter":
                raw_key = settings.OPENROUTER_API_KEY
            elif p == "groq":
                raw_key = settings.GROQ_API_KEY
            elif p == "cerebras":
                raw_key = settings.CEREBRAS_API_KEY
            elif p == "google":
                raw_key = settings.GOOGLE_API_KEY

            key_list = [k.strip() for k in raw_key.split(",") if k.strip()]
            keys[p] = key_list
        return keys

    def get_api_key(self, provider: str) -> str | None:
        """Get current API key with round-robin rotation for multiple keys."""
        key_list = self._api_keys.get(provider, [])
        if not key_list:
            return None
        idx = self._key_indices.get(provider, 0)
        key = key_list[idx % len(key_list)]
        self._key_indices[provider] = (idx + 1) % len(key_list)
        return key

    def resolve_model_slug(self, provider: str, role: ModelRole | str) -> str:
        """Resolve the model slug for a given provider and role with canonical fallbacks."""
        role_str = str(role).upper()
        slug: str | None = None

        default_smart = {
            "groq": "llama-3.3-70b-versatile",
            "openrouter": "meta-llama/llama-3.3-70b-instruct",
            "google": "gemini-1.5-pro",
            "cerebras": "llama3.3-70b",
        }
        default_fast = {
            "groq": "llama-3.1-8b-instant",
            "openrouter": "meta-llama/llama-3.1-8b-instruct",
            "google": "gemini-1.5-flash",
            "cerebras": "llama3.1-8b",
        }

        if "SMART" in role_str:
            slug = self.smart_slugs.get(provider)
            if not slug or slug.lower() in ("slug", "default", "none", ""):
                slug = default_smart.get(provider)
        elif "VISION" in role_str:
            slug = self.vision_slugs.get(provider)
        else:
            slug = self.fast_slugs.get(provider)
            if not slug or slug.lower() in ("slug", "default", "none", ""):
                slug = default_fast.get(provider)

        return slug or f"{provider}-default-model"

    async def complete(self, request: LLMRequest) -> LLMResponse:
        """Execute request across the ordered provider failover chain with retries and circuit breakers."""
        last_error: Exception | None = None
        overall_retries = 0

        # Only attempt providers that have an API key configured (unless using custom test caller)
        eligible_providers = [
            p for p in self.chain if self._custom_caller is not None or bool(self.get_api_key(p))
        ]

        if not eligible_providers:
            raise AuthenticationError(
                "No LLM provider API key configured. Please set GROQ_API_KEY, "
                "OPENROUTER_API_KEY, GOOGLE_API_KEY, or CEREBRAS_API_KEY in your .env file."
            )

        for provider in eligible_providers:
            cb = self.circuit_breakers.setdefault(provider, CircuitBreaker())
            rl = self.rate_limiters.setdefault(provider, ProviderRateLimiter())

            if not cb.is_available():
                logger.warning("Skipping provider '%s': circuit breaker is OPEN", provider)
                continue

            if not rl.can_call():
                logger.warning(
                    "Skipping provider '%s': rate limit exceeded (RPM threshold reached)",
                    provider,
                )
                continue

            model = self.resolve_model_slug(provider, request.role)
            max_retries = settings.LLM_MAX_RETRIES

            for attempt in range(max_retries + 1):
                if attempt > 0:
                    overall_retries += 1
                    # Jittered exponential backoff
                    backoff = min(
                        self._max_backoff_s,
                        self._base_backoff_s * (2 ** (attempt - 1)) + random.uniform(0, 0.05),
                    )
                    if backoff > 0:
                        await asyncio.sleep(backoff)

                try:
                    rl.record_call()

                    if self._custom_caller is not None:
                        # Use custom caller / FakeLLM
                        response = await self._custom_caller(request, provider, model)
                    else:
                        response = await self._execute_http_call(request, provider, model)

                    # Success!
                    cb.record_success()
                    response.retries = overall_retries
                    return response

                except RateLimitExceededError as rle:
                    last_error = rle
                    # If multiple keys available, retry with next key before giving up on provider
                    keys_count = len(self._api_keys.get(provider, []))
                    if keys_count > 1 and attempt < max_retries:
                        logger.warning(
                            "Provider '%s' returned 429; rotating to next API key",
                            provider,
                        )
                        continue
                    logger.warning(
                        "Provider '%s' rate limit exhausted; failing over to next provider",
                        provider,
                    )
                    cb.record_failure()
                    break  # Fail over to next provider

                except (TimeoutError, TimeoutError, httpx.TimeoutException) as te:
                    last_error = te
                    logger.warning(
                        "Provider '%s' timeout on attempt %d: %s",
                        provider,
                        attempt,
                        te,
                    )
                    if attempt >= max_retries:
                        cb.record_failure()
                        break  # Fail over to next provider

                except Exception as err:
                    last_error = err
                    logger.warning(
                        "Provider '%s' error on attempt %d: %s",
                        provider,
                        attempt,
                        err,
                    )
                    if attempt >= max_retries:
                        cb.record_failure()
                        break  # Fail over to next provider

        raise ProviderUnavailableError(
            f"All providers in chain [{', '.join(self.chain)}] failed. Last error: {last_error}"
        )

    async def _execute_http_call(
        self,
        request: LLMRequest,
        provider: str,
        model: str,
    ) -> LLMResponse:
        """Execute HTTP request to OpenAI-compatible provider endpoint."""
        api_key = self.get_api_key(provider)
        if not api_key:
            raise AuthenticationError(f"No API key configured for provider '{provider}'")

        base_url = self._provider_base_urls.get(provider)
        if not base_url:
            raise ProviderUnavailableError(f"No base URL configured for provider '{provider}'")

        endpoint = f"{base_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key.strip()}",
            "Content-Type": "application/json",
        }

        payload: dict[str, Any] = {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in request.messages],
            "temperature": request.temperature,
        }
        if request.max_tokens is not None:
            payload["max_tokens"] = request.max_tokens
        if request.response_format is not None:
            payload["response_format"] = request.response_format

        start_time = time.time()
        timeout = float(settings.LLM_TIMEOUT_S)

        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                res = await client.post(endpoint, json=payload, headers=headers)
            except httpx.TimeoutException as te:
                raise TimeoutError(f"HTTP call to {provider} timed out after {timeout}s") from te
            except httpx.RequestError as re:
                raise ProviderUnavailableError(f"Network error calling {provider}: {re}") from re

        latency_ms = (time.time() - start_time) * 1000

        if res.status_code == 429:
            raise RateLimitExceededError(f"Provider {provider} returned 429: {res.text}")
        if res.status_code >= 500:
            raise ProviderUnavailableError(
                f"Provider {provider} returned server error {res.status_code}"
            )
        if res.status_code != 200:
            raise ProviderUnavailableError(
                f"Provider {provider} returned HTTP {res.status_code}: {res.text}"
            )

        data = res.json()
        content = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        tokens_in = usage.get("prompt_tokens", 0)
        tokens_out = usage.get("completion_tokens", 0)

        return LLMResponse(
            content=content,
            provider=provider,
            model=model,
            role=str(request.role),
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
            raw_response=data,
        )

    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        role: ModelRole | str = ModelRole.FAST,
        temperature: float = 0.0,
        max_tokens: int | None = None,
        user_id: int | None = None,
        course_id: int | None = None,
    ) -> LLMResponse:
        """Convenience method to execute a chat completion with list of message dicts."""
        from app.ai.harness.models import ChatMessage

        chat_msgs = [ChatMessage(role=m["role"], content=m["content"]) for m in messages]
        req = LLMRequest(
            messages=chat_msgs,
            role=role,
            temperature=temperature,
            max_tokens=max_tokens,
            user_id=user_id,
            course_id=course_id,
        )
        return await self.complete(req)
