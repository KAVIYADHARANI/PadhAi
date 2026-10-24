"""Tests for StructuredCall: Pydantic validation, repair retries, caching, and fail-closed errors."""

import pytest
from pydantic import BaseModel, Field

from app.ai.harness.cache import InMemoryCache
from app.ai.harness.exceptions import StructuredOutputError
from app.ai.harness.fake import FakeLLM
from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import ChatMessage
from app.ai.harness.structured import StructuredCall


class SampleResponseSchema(BaseModel):
    summary: str
    confidence: float = Field(ge=0.0, le=1.0)
    tags: list[str]


@pytest.fixture
def fake_llm():
    return FakeLLM()


@pytest.mark.asyncio
async def test_structured_call_valid_json(fake_llm):
    fake_llm.add_response('{"summary": "Physics notes", "confidence": 0.95, "tags": ["physics", "waves"]}')
    gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)
    structured = StructuredCall(gateway=gateway)

    result = await structured.execute(
        schema=SampleResponseSchema,
        messages=[ChatMessage(role="user", content="Summarize notes")],
    )

    assert isinstance(result, SampleResponseSchema)
    assert result.summary == "Physics notes"
    assert result.confidence == 0.95
    assert result.tags == ["physics", "waves"]
    assert fake_llm.call_count == 1


@pytest.mark.asyncio
async def test_structured_call_handles_markdown_code_fences(fake_llm):
    fenced_output = """```json
{
  "summary": "Chemistry review",
  "confidence": 0.88,
  "tags": ["organic", "reactions"]
}
```"""
    fake_llm.add_response(fenced_output)
    gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)
    structured = StructuredCall(gateway=gateway)

    result = await structured.execute(
        schema=SampleResponseSchema,
        messages=[ChatMessage(role="user", content="Analyze chemistry")],
    )

    assert result.summary == "Chemistry review"
    assert result.confidence == 0.88


@pytest.mark.asyncio
async def test_structured_call_retries_on_invalid_output_then_succeeds(fake_llm):
    # Attempt 0 returns invalid JSON (missing required 'summary' and wrong type for confidence)
    fake_llm.add_response('{"confidence": "not-a-number"}')
    # Attempt 1 returns valid JSON
    fake_llm.add_response('{"summary": "Recovered summary", "confidence": 0.9, "tags": ["repaired"]}')

    gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)
    structured = StructuredCall(gateway=gateway)

    result = await structured.execute(
        schema=SampleResponseSchema,
        messages=[ChatMessage(role="user", content="Summarize with repair")],
        max_retries=2,
    )

    assert result.summary == "Recovered summary"
    assert result.confidence == 0.9
    # Initial attempt + 1 retry = 2 calls
    assert fake_llm.call_count == 2


@pytest.mark.asyncio
async def test_structured_call_raises_after_max_retries_exhausted(fake_llm):
    # Enqueue invalid JSON across initial attempt + 2 retries (total 3 attempts)
    fake_llm.add_response('{"invalid": true}')
    fake_llm.add_response('not even json')
    fake_llm.add_response('{"summary": 123, "confidence": 5.0}')  # confidence > 1.0 violates Field constraint

    gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)
    structured = StructuredCall(gateway=gateway)

    with pytest.raises(StructuredOutputError, match="Failed to produce valid structured output"):
        await structured.execute(
            schema=SampleResponseSchema,
            messages=[ChatMessage(role="user", content="Never valid")],
            max_retries=2,
        )

    # Asserts it strictly bounded retries to max_retries (1 initial + 2 retries = 3 calls)
    assert fake_llm.call_count == 3


@pytest.mark.asyncio
async def test_structured_call_caching_and_user_isolation(fake_llm):
    fake_llm.add_response('{"summary": "Cached notes", "confidence": 0.9, "tags": ["cached"]}')
    cache = InMemoryCache()
    gateway = LLMGateway(caller=fake_llm.complete, base_backoff_s=0.0)
    structured = StructuredCall(gateway=gateway, cache=cache)

    # First call for User 1 -> Cache miss, executes LLM
    res1 = await structured.execute(
        schema=SampleResponseSchema,
        messages=[ChatMessage(role="user", content="Same prompt")],
        user_id=1,
        cacheable=True,
    )
    assert res1.summary == "Cached notes"
    assert fake_llm.call_count == 1

    # Second call for User 1 with identical prompt -> Cache hit, 0 additional LLM calls
    res2 = await structured.execute(
        schema=SampleResponseSchema,
        messages=[ChatMessage(role="user", content="Same prompt")],
        user_id=1,
        cacheable=True,
    )
    assert res2.summary == "Cached notes"
    assert fake_llm.call_count == 1

    # Third call for User 2 with identical prompt -> Must NOT hit User 1's cache (user isolation)
    fake_llm.add_response('{"summary": "User 2 notes", "confidence": 0.85, "tags": ["u2"]}')
    res3 = await structured.execute(
        schema=SampleResponseSchema,
        messages=[ChatMessage(role="user", content="Same prompt")],
        user_id=2,
        cacheable=True,
    )
    assert res3.summary == "User 2 notes"
    assert fake_llm.call_count == 2


def test_clean_json_text_with_thinking_tags():
    """Verify clean_json_text strips thinking tags and extracts valid JSON objects."""
    from app.ai.harness.structured import clean_json_text

    raw_output = (
        "<think>Analyzing chunks for topics...</think>\n"
        "Here is the requested JSON:\n"
        "```json\n"
        '{"summary": "Operating Systems", "confidence": 0.9, "tags": ["processes"]}\n'
        "```\n"
        "Let me know if you need changes!"
    )
    cleaned = clean_json_text(raw_output)
    assert cleaned.startswith("{")
    assert cleaned.endswith("}")
    assert "<think>" not in cleaned
