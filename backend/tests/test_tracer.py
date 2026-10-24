"""Tests for Tracer: privacy-safe logging without sensitive text fields."""

import json

import pytest

from app.ai.harness.tracer import TraceEvent, Tracer


def test_tracer_records_valid_numeric_and_id_metadata():
    logged_records = []

    class DummyLogger:
        def info(self, msg, *args, **kwargs):
            logged_records.append(msg)

    tracer = Tracer(trace_logger=DummyLogger())

    event = tracer.record(
        request_id="req-1234-abcd",
        user_id=42,
        course_id=7,
        agent="tutor",
        provider="openrouter",
        model="test-slug",
        latency_ms=124.567,
        tokens_in=120,
        tokens_out=45,
        retries=1,
        status="success",
        guardrail_result="passed",
    )

    assert isinstance(event, TraceEvent)
    assert event.request_id == "req-1234-abcd"
    assert event.user_id == 42
    assert event.latency_ms == 124.57
    assert event.tokens_in == 120
    assert event.tokens_out == 45

    # Verify serialized output
    assert len(logged_records) == 1
    data = json.loads(logged_records[0])
    assert data["request_id"] == "req-1234-abcd"
    assert data["user_id"] == 42
    assert "content" not in data
    assert "prompt" not in data
    assert "response" not in data
    assert "message" not in data


def test_tracer_rejects_smuggled_text_in_categorical_fields():
    tracer = Tracer()
    # Attempting to sneak a 500-char prompt or message into categorical 'agent' field
    fake_prompt = "Explain this long document " * 20

    with pytest.raises(ValueError, match="Privacy violation: string field 'agent' exceeds allowable categorical length"):
        tracer.record(
            request_id="req-1",
            user_id=1,
            course_id=1,
            agent=fake_prompt,
            provider="openrouter",
            model="slug",
            latency_ms=10.0,
            tokens_in=10,
            tokens_out=10,
            retries=0,
            status="success",
        )
