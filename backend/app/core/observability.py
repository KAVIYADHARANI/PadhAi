"""Observability and Error Monitoring Module.

Implements BUILD_PLAYBOOK.md Phase 8 Task 8B and README Section 10:
- Error monitoring hook with Sentry support via SENTRY_DSN env var.
- Non-negotiable security guardrail: scrubs all message text, prompt data,
  and document text from exception frames, breadcrumbs, and event payloads.
- Structured fallback logging when Sentry is not configured.
"""

from typing import Any

from fastapi import FastAPI

from app.core.config import settings
from app.core.logging import get_logger, redact_secrets

logger = get_logger("app.observability")

FORBIDDEN_OBSERVABILITY_KEYS = {
    "message_text",
    "doc_text",
    "document_text",
    "prompt",
    "completion",
    "content",
    "user_input",
    "system_prompt",
    "chunk_text",
    "selected_answer",
    "stem",
    "raw_frame",
    "landmarks",
}


def scrub_sensitive_event_data(data: Any) -> Any:
    """Recursively scrub forbidden text keys and secrets from observability dictionaries/lists."""
    if isinstance(data, dict):
        clean: dict[str, Any] = {}
        for k, v in data.items():
            if str(k).lower() in FORBIDDEN_OBSERVABILITY_KEYS:
                clean[k] = "[REDACTED_BY_SECURITY_RULE]"
            elif isinstance(v, str):
                clean[k] = redact_secrets(v)
            elif isinstance(v, (dict, list)):
                clean[k] = scrub_sensitive_event_data(v)
            else:
                clean[k] = v
        return clean
    elif isinstance(data, list):
        return [scrub_sensitive_event_data(item) for item in data]
    elif isinstance(data, str):
        return redact_secrets(data)
    return data


def sentry_before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any] | None:
    """Sentry event processor that strips sensitive payloads and prompt/document text."""
    # 1. Scrub request data if present
    request_data = event.get("request")
    if isinstance(request_data, dict):
        # Never transmit raw request body data
        if "data" in request_data:
            request_data["data"] = "[REDACTED_BODY]"
        if "headers" in request_data and isinstance(request_data["headers"], dict):
            for h in list(request_data["headers"].keys()):
                if h.lower() in {"authorization", "cookie", "x-api-key"}:
                    request_data["headers"][h] = "[REDACTED]"
        if "query_string" in request_data and isinstance(request_data["query_string"], str):
            request_data["query_string"] = redact_secrets(request_data["query_string"])

    # 2. Scrub breadcrumbs
    breadcrumbs = event.get("breadcrumbs")
    if isinstance(breadcrumbs, dict) and "values" in breadcrumbs:
        for b in breadcrumbs["values"]:
            if isinstance(b.get("data"), dict):
                b["data"] = scrub_sensitive_event_data(b["data"])
            if isinstance(b.get("message"), str):
                b["message"] = redact_secrets(b["message"])

    # 3. Scrub extra and context data
    if "extra" in event and isinstance(event["extra"], dict):
        event["extra"] = scrub_sensitive_event_data(event["extra"])

    if "contexts" in event and isinstance(event["contexts"], dict):
        event["contexts"] = scrub_sensitive_event_data(event["contexts"])

    return event


_SENTRY_INITIALIZED = False


def setup_observability(app: FastAPI | None = None) -> bool:
    """Configures Sentry SDK error monitoring if SENTRY_DSN is provided."""
    global _SENTRY_INITIALIZED
    dsn = settings.SENTRY_DSN
    if not dsn:
        logger.info("SENTRY_DSN not set. Observability running in structured-logging mode.")
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration

        sentry_sdk.init(
            dsn=dsn,
            environment=settings.SENTRY_ENVIRONMENT,
            integrations=[
                FastApiIntegration(),
                LoggingIntegration(level=None, event_level=None),
            ],
            before_send=sentry_before_send,
            send_default_pii=False,
            traces_sample_rate=0.05,
        )
        _SENTRY_INITIALIZED = True
        logger.info("Sentry error monitoring initialized successfully.")
        return True
    except ImportError:
        logger.warning("sentry-sdk not installed. Observability fallback to structured logging.")
        return False
    except Exception as exc:
        logger.error(f"Failed to initialize Sentry: {exc}")
        return False


def capture_exception(
    exc: Exception,
    tags: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Captures exception to Sentry (if enabled) and logs structured event with sanitized fields."""
    safe_tags = scrub_sensitive_event_data(tags or {})
    safe_extra = scrub_sensitive_event_data(extra or {})

    if _SENTRY_INITIALIZED:
        try:
            import sentry_sdk

            with sentry_sdk.push_scope() as scope:
                for k, v in safe_tags.items():
                    scope.set_tag(k, str(v))
                for k, v in safe_extra.items():
                    scope.set_extra(k, v)
                sentry_sdk.capture_exception(exc)
        except Exception:
            pass

    # Structured local log (always safe, scrubbed by SafeJsonFormatter)
    logger.error(
        f"Exception captured: {type(exc).__name__}: {redact_secrets(str(exc))}",
        exc_info=exc,
        extra={"error_tags": safe_tags, "error_extra": safe_extra},
    )
