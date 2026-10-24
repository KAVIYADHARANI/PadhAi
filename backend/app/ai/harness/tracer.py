"""Privacy-safe structured tracing for AI Agent Harness.

SECURITY RULE:
Never log raw message text, prompts, model responses, document contents,
or user materials. The tracer API strictly accepts identifiers, numeric metadata,
and categorical flags only.
"""

import json
import logging
from dataclasses import asdict, dataclass

logger = logging.getLogger("app.tracer")


@dataclass(frozen=True, slots=True)
class TraceEvent:
    """Privacy-safe trace event containing zero message or document text.

    Attributes:
        request_id: Unique correlation ID for the request.
        user_id: Identifier of the invoking user.
        course_id: Identifier of the associated course, if applicable.
        agent: Identifier of the agent / specialist node (e.g. 'tutor', 'router').
        provider: Name of the hosted LLM provider (e.g. 'openrouter', 'groq').
        model: Specific model slug used.
        latency_ms: Call wall-clock latency in milliseconds.
        tokens_in: Input tokens counted/reported.
        tokens_out: Output tokens counted/reported.
        retries: Number of retries executed before success or failure.
        status: Call status ('success', 'error', 'rate_limited', 'timeout').
        guardrail_result: Outcome of guardrail checks (e.g. 'passed', 'blocked').
        error_code: Categorical error code if failed (e.g. 'RATE_LIMIT_EXCEEDED').
        cached: Boolean indicating if response was served from cache.
    """

    request_id: str
    user_id: int | None
    course_id: int | None
    agent: str
    provider: str
    model: str
    latency_ms: float
    tokens_in: int
    tokens_out: int
    retries: int
    status: str
    guardrail_result: str | None = None
    error_code: str | None = None
    cached: bool = False


class Tracer:
    """Structured, privacy-enforcing tracer for LLM calls and harness operations."""

    def __init__(self, trace_logger: logging.Logger | None = None):
        self._logger = trace_logger or logger

    def record(
        self,
        *,
        request_id: str,
        user_id: int | None,
        course_id: int | None,
        agent: str,
        provider: str,
        model: str,
        latency_ms: float,
        tokens_in: int,
        tokens_out: int,
        retries: int,
        status: str,
        guardrail_result: str | None = None,
        error_code: str | None = None,
        cached: bool = False,
    ) -> TraceEvent:
        """Create, validate, and log a privacy-safe trace event.

        This method strictly forbids text, prompt, or response fields.
        """
        # Validate categorical strings cannot be smuggled text
        for name, val in [
            ("agent", agent),
            ("provider", provider),
            ("model", model),
            ("status", status),
            ("guardrail_result", guardrail_result),
            ("error_code", error_code),
        ]:
            if val is not None and len(val) > 128:
                raise ValueError(
                    f"Privacy violation: string field '{name}' exceeds allowable categorical length"
                )

        event = TraceEvent(
            request_id=request_id,
            user_id=user_id,
            course_id=course_id,
            agent=agent,
            provider=provider,
            model=model,
            latency_ms=round(latency_ms, 2),
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            retries=retries,
            status=status,
            guardrail_result=guardrail_result,
            error_code=error_code,
            cached=cached,
        )

        self._logger.info(json.dumps(asdict(event)))
        return event
