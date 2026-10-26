"""Structured output extraction and validation for AI Agent Harness.

Validates model outputs against Pydantic schemas, retrying with detailed validation
errors up to max 2 retries, and raising StructuredOutputError if still invalid.
Never retries indefinitely.
"""

import json
import logging
import re
import time
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from app.ai.harness.budget import RequestBudget
from app.ai.harness.cache import CacheInterface, make_structured_call_cache_key
from app.ai.harness.exceptions import StructuredOutputError
from app.ai.harness.gateway import LLMGateway
from app.ai.harness.guardrails import GuardrailHooks
from app.ai.harness.models import ChatMessage, LLMRequest, ModelRole
from app.ai.harness.tracer import Tracer

logger = logging.getLogger("app.structured")

T = TypeVar("T", bound=BaseModel)


def clean_json_text(text: str) -> str:
    """Strip Markdown code fence wrappers, thinking tags, and leading/trailing text."""
    cleaned = text.strip()
    # Strip <think>...</think> tags if present
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", cleaned).strip()
    # Extract markdown code blocks if present
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
    if match:
        cleaned = match.group(1).strip()
    else:
        # Fallback to outer object or array boundaries if surrounded by conversational text
        json_match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", cleaned)
        if json_match:
            cleaned = json_match.group(1).strip()
    return cleaned


class StructuredCall:
    """Executes structured JSON schema extraction with bounded repair retries."""

    def __init__(
        self,
        gateway: LLMGateway,
        tracer: Tracer | None = None,
        cache: CacheInterface | None = None,
        guardrails: GuardrailHooks | None = None,
    ):
        self.gateway = gateway
        self.tracer = tracer
        self.cache = cache
        self.guardrails = guardrails

    async def execute(
        self,
        schema: type[T],
        messages: list[ChatMessage],
        *,
        role: ModelRole | str = ModelRole.FAST,
        temperature: float = 0.0,
        user_id: int | None = None,
        course_id: int | None = None,
        agent_name: str = "structured_call",
        budget: RequestBudget | None = None,
        max_retries: int = 2,
        cacheable: bool = False,
    ) -> T:
        """Call LLM and parse result into Pydantic schema, retrying up to max_retries on validation failure.

        Fails closed with StructuredOutputError if all attempts fail. Never retries indefinitely.
        """
        # 1. Check cache if applicable
        cache_key: str | None = None
        if self.cache and cacheable:
            payload_repr = [{"role": m.role, "content": m.content} for m in messages]
            cache_key = make_structured_call_cache_key(
                schema_name=schema.__name__,
                messages_payload=payload_repr,
                model=str(role),
                user_id=user_id,
            )
            cached_data = self.cache.get(cache_key)
            if cached_data is not None:
                try:
                    validated = schema.model_validate_json(cached_data)
                    if self.tracer:
                        self.tracer.record(
                            request_id="cached",
                            user_id=user_id,
                            course_id=course_id,
                            agent=agent_name,
                            provider="cache",
                            model="cached",
                            latency_ms=0.0,
                            tokens_in=0,
                            tokens_out=0,
                            retries=0,
                            status="success",
                            cached=True,
                        )
                    return validated
                except ValidationError:
                    self.cache.delete(cache_key)

        # 2. Check budget before starting
        if budget:
            budget.check_budget()

        # Build schema instructions
        schema_json = json.dumps(schema.model_json_schema(), indent=2)
        instruction_msg = ChatMessage(
            role="system",
            content=(
                f"You are a structured data extractor. You must respond ONLY with valid JSON "
                f"matching this JSON schema:\n{schema_json}\n"
                f"Do not include any explanation or markdown text outside the JSON."
            ),
        )

        conversation = [instruction_msg, *messages]
        last_error: str | None = None

        # Max retries loop: attempt 0 is initial, attempts 1..max_retries are repair retries
        for attempt in range(max_retries + 1):
            if budget:
                budget.check_budget()

            request = LLMRequest(
                messages=conversation,
                role=role,
                temperature=temperature,
                response_format={"type": "json_object"},
                user_id=user_id,
                course_id=course_id,
                agent_name=agent_name,
            )

            # Pre-call guardrails
            if self.guardrails:
                request = self.guardrails.run_pre_call(request)

            start_t = time.time()
            response = await self.gateway.complete(request)
            latency_ms = (time.time() - start_t) * 1000

            # Post-call guardrails
            if self.guardrails:
                response = self.guardrails.run_post_call(response, request)

            # Track budget consumption
            if budget:
                budget.consume(
                    calls=1,
                    tokens_in=response.tokens_in,
                    tokens_out=response.tokens_out,
                    prompt_chars=sum(len(m.content) for m in conversation),
                    completion_chars=len(response.content),
                )

            # Validation attempt
            cleaned = clean_json_text(response.content)
            try:
                validated_obj = schema.model_validate_json(cleaned)

                # Log successful trace
                if self.tracer:
                    self.tracer.record(
                        request_id=request.request_id,
                        user_id=user_id,
                        course_id=course_id,
                        agent=agent_name,
                        provider=response.provider,
                        model=response.model,
                        latency_ms=latency_ms,
                        tokens_in=response.tokens_in,
                        tokens_out=response.tokens_out,
                        retries=attempt,
                        status="success",
                    )

                # Cache successful response
                if self.cache and cacheable and cache_key:
                    self.cache.set(cache_key, cleaned, ttl_s=3600)

                return validated_obj

            except (ValidationError, json.JSONDecodeError) as val_err:
                if isinstance(val_err, ValidationError):
                    formatted_errors = []
                    for err in val_err.errors():
                        loc = " -> ".join(str(part) for part in err.get("loc", []))
                        msg = err.get("msg", "")
                        formatted_errors.append(f"- Field '{loc}': {msg}")
                    last_error = "\n".join(formatted_errors)
                else:
                    last_error = str(val_err)

                logger.warning(
                    "Structured validation failed on attempt %d for %s:\n%s",
                    attempt,
                    schema.__name__,
                    last_error,
                )

                if self.tracer:
                    self.tracer.record(
                        request_id=request.request_id,
                        user_id=user_id,
                        course_id=course_id,
                        agent=agent_name,
                        provider=response.provider,
                        model=response.model,
                        latency_ms=latency_ms,
                        tokens_in=response.tokens_in,
                        tokens_out=response.tokens_out,
                        retries=attempt,
                        status="validation_error",
                        error_code="STRUCTURED_OUTPUT_INVALID",
                    )

                if attempt < max_retries:
                    # Append repair turn to conversation with specific schema repair guidance
                    conversation.append(ChatMessage(role="assistant", content=response.content))
                    conversation.append(
                        ChatMessage(
                            role="user",
                            content=(
                                f"Your previous output failed schema validation:\n{last_error}\n\n"
                                f"Please fix the validation errors. Specifically, satisfy all list length requirements "
                                f"(e.g., if a list requires at least 2 items, provide at least 2 complete items) and required fields.\n"
                                f"Return strictly the corrected, valid JSON matching the schema."
                            ),
                        )
                    )

        # Retries exhausted
        raise StructuredOutputError(
            f"Failed to produce valid structured output for {schema.__name__} after {max_retries} retries. "
            f"Last error: {last_error}"
        )
