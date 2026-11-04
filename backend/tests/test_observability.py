"""Unit tests for Observability and Error Monitoring Scrubber.

Implements BUILD_PLAYBOOK.md Phase 8 Task 8B and README Section 10:
- Asserts error monitoring hooks NEVER leak message text or document text.
- Asserts secrets, tokens, and authorization headers are scrubbed.
"""

from app.core.observability import (
    capture_exception,
    scrub_sensitive_event_data,
    sentry_before_send,
    setup_observability,
)


def test_scrub_sensitive_event_data_redacts_text_and_secrets():
    """Event data scrubber must redact forbidden keys and sensitive API tokens."""
    payload = {
        "event_id": "evt_123",
        "user_id": 42,
        "message_text": "Sensitive student question text here",
        "doc_text": "Classified study syllabus page content",
        "prompt": "You are a tutor...",
        "completion": "Answer: 42",
        "chunk_text": "Retrieved chunk excerpt",
        "raw_frame": "binary-frame-data",
        "auth_header": "Bearer sk-or-v1-abcdef1234567890abcdef1234567890",
        "nested": {
            "user_input": "Nested prompt injection test",
            "normal_field": "public_metadata",
            "token": "AIzaSyTestApiKeyForGoogleCloud12345678",
        },
        "items": [
            {"document_text": "Doc in list"},
            {"count": 5},
        ],
    }

    cleaned = scrub_sensitive_event_data(payload)

    # Forbidden keys must be replaced with security rule marker
    assert cleaned["message_text"] == "[REDACTED_BY_SECURITY_RULE]"
    assert cleaned["doc_text"] == "[REDACTED_BY_SECURITY_RULE]"
    assert cleaned["prompt"] == "[REDACTED_BY_SECURITY_RULE]"
    assert cleaned["completion"] == "[REDACTED_BY_SECURITY_RULE]"
    assert cleaned["chunk_text"] == "[REDACTED_BY_SECURITY_RULE]"
    assert cleaned["raw_frame"] == "[REDACTED_BY_SECURITY_RULE]"
    assert cleaned["nested"]["user_input"] == "[REDACTED_BY_SECURITY_RULE]"
    assert cleaned["items"][0]["document_text"] == "[REDACTED_BY_SECURITY_RULE]"

    # Non-sensitive keys are preserved
    assert cleaned["event_id"] == "evt_123"
    assert cleaned["user_id"] == 42
    assert cleaned["nested"]["normal_field"] == "public_metadata"
    assert cleaned["items"][1]["count"] == 5

    # Secrets must be scrubbed
    assert "sk-or-v1" not in cleaned["auth_header"]
    assert "[REDACTED]" in cleaned["auth_header"]
    assert "AIzaSy" not in cleaned["nested"]["token"]
    assert "[REDACTED_API_KEY]" in cleaned["nested"]["token"]


def test_sentry_before_send_strips_request_body_and_auth_headers():
    """Sentry event processor strips raw HTTP payloads and authorization headers."""
    raw_event = {
        "event_id": "abc12345",
        "request": {
            "url": "https://api.padhai.internal/api/courses/1/chat",
            "data": {"message": "How do I solve problem 3?"},
            "headers": {
                "Authorization": "Bearer eyJhbGciOiJ...",
                "Cookie": "session_id=secret123",
                "User-Agent": "Mozilla/5.0",
            },
            "query_string": "key=AIzaSySecretApiKey1234567890",
        },
        "breadcrumbs": {
            "values": [
                {
                    "message": "Calling model with token Bearer sk-or-v1-testkey123456",
                    "data": {"doc_text": "Some text"},
                }
            ]
        },
    }

    processed = sentry_before_send(raw_event, {})
    assert processed is not None

    req = processed["request"]
    assert req["data"] == "[REDACTED_BODY]"
    assert req["headers"]["Authorization"] == "[REDACTED]"
    assert req["headers"]["Cookie"] == "[REDACTED]"
    assert req["headers"]["User-Agent"] == "Mozilla/5.0"
    assert "AIzaSy" not in req["query_string"]

    b = processed["breadcrumbs"]["values"][0]
    assert "sk-or-v1" not in b["message"]
    assert b["data"]["doc_text"] == "[REDACTED_BY_SECURITY_RULE]"


def test_setup_observability_without_dsn_safe_fallback():
    """When SENTRY_DSN is not configured, setup returns False and operates safely in logging mode."""
    res = setup_observability()
    assert res is False


def test_capture_exception_executes_safely():
    """capture_exception must log cleanly without raising exceptions."""
    try:
        raise ValueError("Simulated calculation error")
    except Exception as exc:
        capture_exception(
            exc,
            tags={"user_id": 1, "route": "/api/chat"},
            extra={"prompt": "forbidden prompt text", "status": "failed"},
        )
